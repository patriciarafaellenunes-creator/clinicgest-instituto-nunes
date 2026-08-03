// test/lab-orders.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const labOrderService = require('../src/services/labOrderService');
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
  const userId = randomUUID();
  const patientId = randomUUID();
  const professionalId = randomUUID();
  const supplierId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO suppliers (id, clinic_id, legal_name) VALUES ($1,$2,'Laboratório Prótese Rápida')`, [supplierId, clinicId]);

  console.log('\n== Teste: criação e status ==');

  const order = await labOrderService.createLabOrder(client, {
    clinicId, patientId, professionalId, supplierId, workType: 'Coroa em zircônia', toothOrRegion: '26',
    color: 'A2', material: 'Zircônia', cost: 650, sentAt: '2026-06-01', expectedDeliveryDate: '2026-06-10', userId,
  });
  assert(order.status === 'solicitacao_criada', 'trabalho criado com status inicial');

  await labOrderService.updateLabOrderStatus(client, { id: order.id, clinicId, userId, status: 'enviado' });
  await labOrderService.updateLabOrderStatus(client, { id: order.id, clinicId, userId, status: 'em_producao' });

  console.log('\n== Teste: detecção de atraso ==');

  const overdue = await labOrderService.getOverdueLabOrders(client, clinicId);
  assert(overdue.length === 1 && overdue[0].id === order.id, 'trabalho com previsão de entrega vencida (2026-06-10, no passado) aparece no alerta de atraso');
  assert(overdue[0].patient_name === 'Paciente Teste' && overdue[0].supplier_name === 'Laboratório Prótese Rápida', 'alerta já vem com nome do paciente e do laboratório');

  console.log('\n== Teste: recebimento registra a data automaticamente ==');

  const received = await labOrderService.updateLabOrderStatus(client, { id: order.id, clinicId, userId, status: 'recebido' });
  assert(received.received_at !== null, 'data de recebimento preenchida automaticamente ao marcar como recebido');

  const overdueAfterReceiving = await labOrderService.getOverdueLabOrders(client, clinicId);
  assert(overdueAfterReceiving.length === 0, 'trabalho recebido sai da lista de atraso mesmo com data prevista no passado');

  console.log('\n== Teste: finalização gera conta a pagar de verdade ==');

  let missingCostBlocked = false;
  const orderNoCost = await labOrderService.createLabOrder(client, {
    clinicId, patientId, professionalId, supplierId, workType: 'Ajuste simples', userId,
  });
  try {
    await labOrderService.finalizeLabOrder(client, { id: orderNoCost.id, clinicId, userId, dueDate: '2026-07-01' });
  } catch (err) {
    missingCostBlocked = err.code === 'MISSING_COST';
  }
  assert(missingCostBlocked, 'trabalho sem custo definido não pode gerar conta a pagar');

  const { labOrder: finalized, accountPayable } = await labOrderService.finalizeLabOrder(client, {
    id: order.id, clinicId, userId, dueDate: '2026-07-01',
  });
  assert(finalized.status === 'finalizado', 'trabalho marcado como finalizado');
  assert(Number(accountPayable.amount) === 650, `conta a pagar gerada com o valor correto do trabalho (veio ${accountPayable.amount})`);
  assert(finalized.accounts_payable_id === accountPayable.id, 'trabalho referencia a conta a pagar gerada');

  const projection = await financialService.getCashProjection(client, clinicId, 60);
  assert(projection.expectedOut >= 650, 'financeiro já enxerga essa conta a pagar na projeção de caixa');

  let doubleFinalizeBlocked = false;
  try {
    await labOrderService.finalizeLabOrder(client, { id: order.id, clinicId, userId, dueDate: '2026-07-01' });
  } catch (err) {
    doubleFinalizeBlocked = err.code === 'ALREADY_FINALIZED';
  }
  assert(doubleFinalizeBlocked, 'finalizar duas vezes é bloqueado — não gera conta a pagar duplicada');

  const allOrders = await labOrderService.listLabOrders(client, clinicId);
  assert(allOrders.length === 2 && allOrders.every((o) => o.patient_name && o.professional_name && o.supplier_name), 'listagem geral traz nome de paciente, profissional e laboratório em todos os trabalhos');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
