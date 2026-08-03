// src/services/purchasingService.js
//
// Fluxo de compras (seção 14 do briefing): solicitação -> aprovação ->
// pedido -> recebimento -> conferência -> entrada no estoque -> conta a
// pagar gerada automaticamente. Este service é deliberadamente fino: ele não
// reimplementa lógica de estoque ou financeiro, só orquestra
// inventoryService.receiveStock e financialService.createAccountPayable na
// hora certa — a mesma filosofia usada em budgetsService (orçamento gera
// contrato/parcelas chamando financialService, não duplicando a lógica).

const { logAudit } = require('./auditService');
const inventoryService = require('./inventoryService');
const financialService = require('./financialService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

async function createSupplier(client, { clinicId, legalName, tradeName, cnpjCpf, contactPhone, contactEmail, userId }) {
  if (!legalName || !legalName.trim()) throw new DomainError('Razão social é obrigatória.', 'INVALID_NAME');

  const { rows } = await client.query(
    `INSERT INTO suppliers (clinic_id, legal_name, trade_name, cnpj_cpf, contact_phone, contact_email)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [clinicId, legalName.trim(), tradeName || null, cnpjCpf || null, contactPhone || null, contactEmail || null]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'suppliers', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

async function createPurchaseOrder(client, { clinicId, supplierId, items, userId }) {
  if (!items || items.length === 0) throw new DomainError('Pedido de compra precisa de ao menos um item.', 'EMPTY_ORDER');

  const totalAmount = items.reduce((acc, item) => acc + item.quantity * item.unitCost, 0);

  const { rows } = await client.query(
    `INSERT INTO purchase_orders (clinic_id, supplier_id, status, total_amount) VALUES ($1,$2,'solicitado',$3) RETURNING *`,
    [clinicId, supplierId, totalAmount]
  );
  const order = rows[0];

  for (const item of items) {
    await client.query(
      `INSERT INTO purchase_order_items (purchase_order_id, item_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)`,
      [order.id, item.itemId, item.quantity, item.unitCost]
    );
  }

  await logAudit(client, { clinicId, userId, tableName: 'purchase_orders', recordId: order.id, action: 'insert', afterValue: order });
  return order;
}

async function approvePurchaseOrder(client, { id, clinicId, userId }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Pedido de compra não encontrado.', 'NOT_FOUND');
  if (before.status !== 'solicitado') {
    throw new DomainError(`Pedido no status "${before.status}" não pode ser aprovado.`, 'INVALID_TRANSITION');
  }

  const { rows } = await client.query(`UPDATE purchase_orders SET status = 'aprovado' WHERE id = $1 RETURNING *`, [id]);
  await logAudit(client, { clinicId, userId, tableName: 'purchase_orders', recordId: id, action: 'approve', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

/**
 * Recebe a mercadoria: dá entrada em cada item no estoque (atualizando o
 * custo médio ponderado) e gera automaticamente a conta a pagar
 * correspondente ao fornecedor. Tudo na mesma transação — se faltar
 * qualquer coisa, nada fica pela metade.
 */
async function receivePurchaseOrder(client, { id, clinicId, userId, dueDate, categoryId, costCenterId, bankAccountId }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Pedido de compra não encontrado.', 'NOT_FOUND');
  if (!['aprovado', 'pedido'].includes(before.status)) {
    throw new DomainError(`Pedido no status "${before.status}" não pode ser recebido.`, 'INVALID_TRANSITION');
  }
  if (!dueDate) throw new DomainError('Data de vencimento da conta a pagar é obrigatória.', 'MISSING_DUE_DATE');

  const { rows: items } = await client.query(
    `SELECT poi.*, ii.name AS item_name FROM purchase_order_items poi
     JOIN inventory_items ii ON ii.id = poi.item_id WHERE poi.purchase_order_id = $1`,
    [id]
  );

  for (const item of items) {
    await inventoryService.receiveStock(client, {
      itemId: item.item_id, clinicId, userId, quantity: item.quantity, unitCost: item.unit_cost,
    });
  }

  const { rows: supplierRows } = await client.query(`SELECT legal_name FROM suppliers WHERE id = $1`, [before.supplier_id]);
  const supplierName = supplierRows[0] ? supplierRows[0].legal_name : 'Fornecedor';

  const accountPayable = await financialService.createAccountPayable(client, {
    clinicId, unitId: null, supplierId: before.supplier_id, bankAccountId: bankAccountId || null,
    categoryId: categoryId || null, costCenterId: costCenterId || null,
    description: `Compra de materiais — ${supplierName} (pedido ${id})`,
    competenceDate: new Date().toISOString().slice(0, 10), dueDate, amount: before.total_amount,
    isRecurring: false, userId,
  });

  const { rows: updated } = await client.query(
    `UPDATE purchase_orders SET status = 'recebido', accounts_payable_id = $1 WHERE id = $2 RETURNING *`,
    [accountPayable.id, id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'purchase_orders', recordId: id, action: 'receive', beforeValue: before, afterValue: updated[0],
  });

  return { purchaseOrder: updated[0], accountPayable, itemsReceived: items };
}

/** Lista os pedidos de compra da clínica (com nome do fornecedor) — usado pela tela de Compras. */
async function listPurchaseOrders(client, clinicId) {
  const { rows } = await client.query(
    `SELECT po.*, s.legal_name AS supplier_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.clinic_id = $1 ORDER BY po.created_at DESC`,
    [clinicId]
  );
  return rows;
}

async function getPurchaseOrderWithItems(client, clinicId, id) {
  const { rows: orderRows } = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const order = orderRows[0];
  if (!order) throw new DomainError('Pedido de compra não encontrado.', 'NOT_FOUND');

  const { rows: items } = await client.query(
    `SELECT poi.*, ii.name AS item_name FROM purchase_order_items poi
     JOIN inventory_items ii ON ii.id = poi.item_id WHERE poi.purchase_order_id = $1`,
    [id]
  );
  return { ...order, items };
}

module.exports = {
  DomainError,
  createSupplier, createPurchaseOrder, approvePurchaseOrder, receivePurchaseOrder,
  listPurchaseOrders, getPurchaseOrderWithItems,
};
