// test/purchasing.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const purchasingService = require('../src/services/purchasingService');
const inventoryService = require('../src/services/inventoryService');
const financialService = require('../src/services/financialService');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

async function main() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => require('crypto').randomUUID(),
    impure: true,
  });

  let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  schema = schema.replace(/CREATE EXTENSION.*\n/g, '');
  db.public.none(schema);

  const { Client } = db.adapters.createPg();
  const client = new Client();
  await client.connect();

  const { randomUUID } = require('crypto');
  const companyId = randomUUID();
  const clinicId = randomUUID();
  const unitId = randomUUID();
  const userId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);

  console.log('\n== Teste: Fornecedor e pedido de compra ==');

  const supplier = await purchasingService.createSupplier(client, {
    clinicId, legalName: 'Dental Supply LTDA', tradeName: 'Dental Supply', cnpjCpf: '11.222.333/0001-44', userId,
  });
  assert(supplier.legal_name === 'Dental Supply LTDA', 'fornecedor criado');

  const item = await inventoryService.createItem(client, { clinicId, unitId, name: 'Luva M', minQuantity: 20, userId });
  await inventoryService.receiveStock(client, { itemId: item.id, clinicId, userId, quantity: 5, unitCost: 10 }); // estoque inicial baixo, pra depois comparar

  const order = await purchasingService.createPurchaseOrder(client, {
    clinicId, supplierId: supplier.id, userId,
    items: [{ itemId: item.id, quantity: 50, unitCost: 12 }],
  });
  assert(order.status === 'solicitado', 'pedido criado como solicitado');
  assert(Number(order.total_amount) === 600, `total do pedido calculado corretamente (50 x 12 = 600, veio ${order.total_amount})`);

  let blocked = false;
  try {
    await purchasingService.receivePurchaseOrder(client, { id: order.id, clinicId, userId, dueDate: '2026-08-10' });
  } catch (err) {
    blocked = err.code === 'INVALID_TRANSITION';
  }
  assert(blocked, 'não é possível receber um pedido ainda não aprovado');

  const approved = await purchasingService.approvePurchaseOrder(client, { id: order.id, clinicId, userId });
  assert(approved.status === 'aprovado', 'pedido aprovado');

  console.log('\n== Teste: Recebimento gera entrada de estoque + conta a pagar ==');

  const { purchaseOrder, accountPayable, itemsReceived } = await purchasingService.receivePurchaseOrder(client, {
    id: order.id, clinicId, userId, dueDate: '2026-08-10',
  });

  assert(purchaseOrder.status === 'recebido', 'pedido marcado como recebido');
  assert(itemsReceived.length === 1, 'um item processado no recebimento');

  const updatedItem = (await client.query(`SELECT * FROM inventory_items WHERE id = $1`, [item.id])).rows[0];
  assert(Number(updatedItem.current_quantity) === 55, `estoque somou a quantidade recebida (5 + 50 = 55, veio ${updatedItem.current_quantity})`);
  // custo médio ponderado: (5*10 + 50*12) / 55 = 11.818...
  const expectedAvgCost = (5 * 10 + 50 * 12) / 55;
  assert(Math.abs(Number(updatedItem.avg_cost) - expectedAvgCost) < 0.01, `custo médio ponderado recalculado no recebimento (esperado ${expectedAvgCost.toFixed(2)}, veio ${updatedItem.avg_cost})`);

  assert(accountPayable.amount == 600, 'conta a pagar gerada com o valor total do pedido');
  assert(accountPayable.status === 'pendente', 'conta a pagar criada como pendente, pronta para aparecer no financeiro');
  assert(purchaseOrder.accounts_payable_id === accountPayable.id, 'pedido de compra referencia a conta a pagar gerada');

  console.log('\n== Teste: Financeiro enxerga a conta a pagar gerada pela compra ==');

  const overdueBefore = await financialService.getCashProjection(client, clinicId, 60);
  assert(overdueBefore.expectedOut >= 600, `projeção de caixa já considera a conta a pagar da compra (esperado >= 600, veio ${overdueBefore.expectedOut})`);

  const orders = await purchasingService.listPurchaseOrders(client, clinicId);
  assert(orders.length === 1 && orders[0].status === 'recebido' && orders[0].supplier_name, 'listagem de pedidos traz o pedido com nome do fornecedor');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
