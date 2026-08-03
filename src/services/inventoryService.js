// src/services/inventoryService.js
//
// Regras centrais (seção 13 do briefing):
//   - Entrada de estoque recalcula o custo médio ponderado do item.
//   - Saída não pode deixar a quantidade negativa (exceto ajuste explícito,
//     que serve justamente para corrigir uma contagem de inventário).
//   - Toda movimentação fica rastreável em inventory_movements.
//   - Ficha técnica (procedure_materials) permite consumo automático de
//     estoque quando um atendimento é finalizado, sem o profissional
//     precisar lançar cada material manualmente.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

async function createItem(client, { clinicId, unitId, name, category, unitOfMeasure, minQuantity, userId }) {
  if (!name || !name.trim()) throw new DomainError('Nome do item é obrigatório.', 'INVALID_NAME');

  const { rows } = await client.query(
    `INSERT INTO inventory_items (clinic_id, unit_id, name, category, unit_of_measure, min_quantity, current_quantity, avg_cost)
     VALUES ($1,$2,$3,$4,$5,$6,0,0) RETURNING *`,
    [clinicId, unitId || null, name.trim(), category || null, unitOfMeasure || null, minQuantity || 0]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'inventory_items', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

/** Entrada de estoque: aumenta a quantidade e recalcula o custo médio ponderado. */
async function receiveStock(client, { itemId, clinicId, userId, quantity, unitCost, responsibleUserId }) {
  if (quantity <= 0) throw new DomainError('Quantidade de entrada deve ser maior que zero.', 'INVALID_QUANTITY');

  const { rows: itemRows } = await client.query(`SELECT * FROM inventory_items WHERE id = $1 AND clinic_id = $2 FOR UPDATE`, [itemId, clinicId]);
  const item = itemRows[0];
  if (!item) throw new DomainError('Item de estoque não encontrado.', 'NOT_FOUND');

  const currentQty = Number(item.current_quantity);
  const currentCost = Number(item.avg_cost);
  const newQty = currentQty + Number(quantity);
  const newAvgCost = newQty > 0
    ? ((currentQty * currentCost) + (Number(quantity) * Number(unitCost || currentCost))) / newQty
    : 0;

  const { rows: updated } = await client.query(
    `UPDATE inventory_items SET current_quantity = $1, avg_cost = $2 WHERE id = $3 RETURNING *`,
    [newQty, newAvgCost, itemId]
  );

  await client.query(
    `INSERT INTO inventory_movements (item_id, movement_type, quantity, responsible_user_id) VALUES ($1,'entrada',$2,$3)`,
    [itemId, quantity, responsibleUserId || userId]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'inventory_items', recordId: itemId, action: 'stock_in', beforeValue: item, afterValue: updated[0],
  });

  return updated[0];
}

/** Saída de estoque (uso, perda, avaria). Bloqueia se não houver quantidade suficiente. */
async function consumeStock(client, { itemId, clinicId, userId, quantity, movementType = 'saida', relatedAppointmentId, responsibleUserId }) {
  if (quantity <= 0) throw new DomainError('Quantidade de saída deve ser maior que zero.', 'INVALID_QUANTITY');

  const { rows: itemRows } = await client.query(`SELECT * FROM inventory_items WHERE id = $1 AND clinic_id = $2 FOR UPDATE`, [itemId, clinicId]);
  const item = itemRows[0];
  if (!item) throw new DomainError('Item de estoque não encontrado.', 'NOT_FOUND');

  const currentQty = Number(item.current_quantity);
  if (currentQty - Number(quantity) < 0) {
    throw new DomainError(
      `Estoque insuficiente de "${item.name}" (disponível: ${currentQty}, solicitado: ${quantity}).`,
      'INSUFFICIENT_STOCK'
    );
  }

  const { rows: updated } = await client.query(
    `UPDATE inventory_items SET current_quantity = current_quantity - $1 WHERE id = $2 RETURNING *`,
    [quantity, itemId]
  );

  await client.query(
    `INSERT INTO inventory_movements (item_id, movement_type, quantity, related_appointment_id, responsible_user_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [itemId, movementType, quantity, relatedAppointmentId || null, responsibleUserId || userId]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'inventory_items', recordId: itemId, action: movementType, beforeValue: item, afterValue: updated[0],
  });

  return updated[0];
}

/** Ajuste de inventário: define a quantidade correta diretamente (contagem física), permite corrigir para cima ou para baixo. */
async function adjustStock(client, { itemId, clinicId, userId, newQuantity, reason }) {
  const { rows: itemRows } = await client.query(`SELECT * FROM inventory_items WHERE id = $1 AND clinic_id = $2 FOR UPDATE`, [itemId, clinicId]);
  const item = itemRows[0];
  if (!item) throw new DomainError('Item de estoque não encontrado.', 'NOT_FOUND');
  if (newQuantity < 0) throw new DomainError('Quantidade não pode ser negativa.', 'INVALID_QUANTITY');

  const delta = Number(newQuantity) - Number(item.current_quantity);

  const { rows: updated } = await client.query(
    `UPDATE inventory_items SET current_quantity = $1 WHERE id = $2 RETURNING *`,
    [newQuantity, itemId]
  );

  await client.query(
    `INSERT INTO inventory_movements (item_id, movement_type, quantity, responsible_user_id) VALUES ($1,'ajuste',$2,$3)`,
    [itemId, delta, userId]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'inventory_items', recordId: itemId, action: 'ajuste',
    beforeValue: item, afterValue: { ...updated[0], reason: reason || null },
  });

  return updated[0];
}

/**
 * Consome automaticamente os materiais da ficha técnica do procedimento
 * vinculado a um agendamento (chamado ao finalizar o atendimento).
 * Bloqueia (com mensagem clara) se faltar qualquer material da lista —
 * nenhum é consumido parcialmente.
 */
async function consumeForAppointment(client, { appointmentId, clinicId, userId }) {
  const { rows: apptRows } = await client.query(`SELECT * FROM appointments WHERE id = $1 AND clinic_id = $2`, [appointmentId, clinicId]);
  const appointment = apptRows[0];
  if (!appointment) throw new DomainError('Agendamento não encontrado.', 'NOT_FOUND');
  if (!appointment.procedure_id) return []; // nada a consumir se não há procedimento definido

  const { rows: materials } = await client.query(
    `SELECT pm.*, ii.name AS item_name, ii.current_quantity FROM procedure_materials pm
     JOIN inventory_items ii ON ii.id = pm.item_id WHERE pm.procedure_id = $1`,
    [appointment.procedure_id]
  );
  if (materials.length === 0) return [];

  const missing = materials.filter((m) => Number(m.current_quantity) < Number(m.quantity_per_procedure));
  if (missing.length > 0) {
    throw new DomainError(
      `Estoque insuficiente para o procedimento: ${missing.map((m) => m.item_name).join(', ')}.`,
      'INSUFFICIENT_STOCK'
    );
  }

  const consumed = [];
  for (const material of materials) {
    const result = await consumeStock(client, {
      itemId: material.item_id, clinicId, userId, quantity: material.quantity_per_procedure,
      movementType: 'saida', relatedAppointmentId: appointmentId,
    });
    consumed.push(result);
  }
  return consumed;
}

/** Lista todos os itens de estoque da clínica — usado pela tela de Estoque. */
async function listItems(client, clinicId) {
  const { rows } = await client.query(
    `SELECT * FROM inventory_items WHERE clinic_id = $1 ORDER BY name`,
    [clinicId]
  );
  return rows;
}

async function getLowStockItems(client, clinicId) {
  const { rows } = await client.query(
    `SELECT * FROM inventory_items WHERE clinic_id = $1 AND current_quantity <= min_quantity ORDER BY name`,
    [clinicId]
  );
  return rows;
}

async function getItemMovementHistory(client, clinicId, itemId) {
  const { rows: itemRows } = await client.query(`SELECT id FROM inventory_items WHERE id = $1 AND clinic_id = $2`, [itemId, clinicId]);
  if (!itemRows[0]) throw new DomainError('Item de estoque não encontrado.', 'NOT_FOUND');

  const { rows } = await client.query(
    `SELECT * FROM inventory_movements WHERE item_id = $1 ORDER BY created_at DESC`,
    [itemId]
  );
  return rows;
}

module.exports = {
  DomainError,
  createItem, receiveStock, consumeStock, adjustStock, consumeForAppointment,
  listItems, getLowStockItems, getItemMovementHistory,
};
