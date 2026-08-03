// test/inventory.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const inventoryService = require('../src/services/inventoryService');
const agendaService = require('../src/services/agendaService');

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
  const patientId = randomUUID();
  const professionalId = randomUUID();
  const procedureId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Restauração', 300)`, [procedureId, clinicId]);

  console.log('\n== Teste: Custo médio ponderado ==');

  const item = await inventoryService.createItem(client, {
    clinicId, unitId, name: 'Resina composta', category: 'material odontológico', unitOfMeasure: 'unidade', minQuantity: 5, userId,
  });
  assert(Number(item.current_quantity) === 0 && Number(item.avg_cost) === 0, 'item criado zerado');

  await inventoryService.receiveStock(client, { itemId: item.id, clinicId, userId, quantity: 10, unitCost: 20 });
  let updated = (await client.query(`SELECT * FROM inventory_items WHERE id = $1`, [item.id])).rows[0];
  assert(Number(updated.current_quantity) === 10 && Number(updated.avg_cost) === 20, 'primeira entrada define custo médio (10 un a R$20)');

  await inventoryService.receiveStock(client, { itemId: item.id, clinicId, userId, quantity: 10, unitCost: 30 });
  updated = (await client.query(`SELECT * FROM inventory_items WHERE id = $1`, [item.id])).rows[0];
  // (10*20 + 10*30) / 20 = 25
  assert(Number(updated.current_quantity) === 20 && Number(updated.avg_cost) === 25, `custo médio ponderado recalculado corretamente (esperado 25, veio ${updated.avg_cost})`);

  console.log('\n== Teste: Saída bloqueia estoque insuficiente ==');

  let blocked = false;
  try {
    await inventoryService.consumeStock(client, { itemId: item.id, clinicId, userId, quantity: 999 });
  } catch (err) {
    blocked = err.code === 'INSUFFICIENT_STOCK';
  }
  assert(blocked, 'saída maior que o estoque disponível é bloqueada');

  await inventoryService.consumeStock(client, { itemId: item.id, clinicId, userId, quantity: 5 });
  updated = (await client.query(`SELECT * FROM inventory_items WHERE id = $1`, [item.id])).rows[0];
  assert(Number(updated.current_quantity) === 15, 'saída válida reduz a quantidade corretamente');

  console.log('\n== Teste: Alerta de estoque mínimo ==');

  const lowItem = await inventoryService.createItem(client, { clinicId, unitId, name: 'Luva P', minQuantity: 50, userId });
  await inventoryService.receiveStock(client, { itemId: lowItem.id, clinicId, userId, quantity: 10, unitCost: 1 });
  const lowStock = await inventoryService.getLowStockItems(client, clinicId);
  assert(lowStock.some((i) => i.id === lowItem.id), 'item abaixo do mínimo aparece no alerta de estoque baixo');
  assert(!lowStock.some((i) => i.id === item.id), 'item acima do mínimo não aparece no alerta');

  const allItems = await inventoryService.listItems(client, clinicId);
  assert(allItems.length === 2, `listagem geral traz todos os itens, não só os com estoque baixo (veio ${allItems.length})`);

  console.log('\n== Teste: Ficha técnica + consumo automático ao finalizar atendimento ==');

  await client.query(
    `INSERT INTO procedure_materials (procedure_id, item_id, quantity_per_procedure) VALUES ($1,$2,$3)`,
    [procedureId, item.id, 2]
  );

  const { appointment } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId, professionalId, procedureId,
    startsAt: '2026-07-22T10:00:00Z', endsAt: '2026-07-22T11:00:00Z', userId,
  });

  await agendaService.updateAppointmentStatus(client, { id: appointment.id, clinicId, userId, status: 'em_atendimento' });
  const consumed = await inventoryService.consumeForAppointment(client, { appointmentId: appointment.id, clinicId, userId });
  assert(consumed.length === 1, 'um material foi consumido conforme a ficha técnica');
  assert(Number(consumed[0].current_quantity) === 13, `estoque debitado conforme a ficha técnica (15 - 2 = 13, veio ${consumed[0].current_quantity})`);

  const { rows: movementForAppt } = await client.query(
    `SELECT * FROM inventory_movements WHERE related_appointment_id = $1`, [appointment.id]
  );
  assert(movementForAppt.length === 1, 'movimentação de estoque vinculada ao agendamento fica rastreável');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
