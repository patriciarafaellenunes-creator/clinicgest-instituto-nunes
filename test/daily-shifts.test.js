// test/daily-shifts.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const dailyShiftsService = require('../src/services/dailyShiftsService');
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
  const professionalId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Central')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dr. Convidado','dentista')`, [professionalId, clinicId]);

  console.log('\n== Teste: criação de diária ==');

  const shift1 = await dailyShiftsService.createDailyShift(client, {
    clinicId, unitId, professionalId, specialty: 'Implantodontia', shiftDate: '2026-07-10', serviceType: 'Cirurgia', amount: 450, userId,
  });
  assert(shift1.status === 'pendente', 'diária criada com status inicial pendente');

  let missingAmountBlocked = false;
  try {
    await dailyShiftsService.createDailyShift(client, {
      clinicId, unitId, professionalId, shiftDate: '2026-07-11', serviceType: 'Consulta', amount: 0, userId,
    });
  } catch (err) {
    missingAmountBlocked = err.code === 'INVALID_AMOUNT';
  }
  assert(missingAmountBlocked, 'diária com valor zero é rejeitada');

  console.log('\n== Teste: aprovação ==');

  let approveBeforePendingBlocked = false;
  const shift2 = await dailyShiftsService.createDailyShift(client, {
    clinicId, unitId, professionalId, shiftDate: '2026-07-12', serviceType: 'Consulta', amount: 300, userId,
  });
  await dailyShiftsService.approveDailyShift(client, { id: shift1.id, clinicId, userId });
  await dailyShiftsService.approveDailyShift(client, { id: shift2.id, clinicId, userId });
  try {
    await dailyShiftsService.approveDailyShift(client, { id: shift1.id, clinicId, userId });
  } catch (err) {
    approveBeforePendingBlocked = err.code === 'INVALID_STATUS';
  }
  assert(approveBeforePendingBlocked, 'aprovar uma diária que já foi aprovada é bloqueado');

  console.log('\n== Teste: pagamento em lote gera uma única conta a pagar ==');

  const { accountPayable, shifts } = await dailyShiftsService.payDailyShifts(client, {
    clinicId, professionalId, periodStart: '2026-07-01', periodEnd: '2026-07-31', dueDate: '2026-08-05', userId,
  });
  assert(Number(accountPayable.amount) === 750, `conta a pagar soma as duas diárias aprovadas (veio ${accountPayable.amount})`);
  assert(accountPayable.cost_nature === 'variavel', 'conta a pagar de diárias é classificada como custo variável');
  assert(shifts.every((s) => s.status === 'pago' && s.accounts_payable_id === accountPayable.id), 'ambas as diárias marcadas como pagas, vinculadas à mesma conta a pagar');

  const projection = await financialService.getCashProjection(client, clinicId, 60);
  assert(projection.expectedOut >= 750, 'financeiro já enxerga essa conta a pagar na projeção de caixa');

  console.log('\n== Teste: pagar de novo no mesmo período não encontra nada elegível ==');

  let nothingEligible = false;
  try {
    await dailyShiftsService.payDailyShifts(client, {
      clinicId, professionalId, periodStart: '2026-07-01', periodEnd: '2026-07-31', dueDate: '2026-08-05', userId,
    });
  } catch (err) {
    nothingEligible = err.code === 'NOTHING_ELIGIBLE';
  }
  assert(nothingEligible, 'diárias já pagas não são selecionadas de novo — sem pagamento duplicado');

  console.log('\n== Teste: listagem por profissional e período ==');

  const shift3 = await dailyShiftsService.createDailyShift(client, {
    clinicId, unitId, professionalId, shiftDate: '2026-08-01', serviceType: 'Cirurgia', amount: 500, userId,
  });
  const list = await dailyShiftsService.listDailyShifts(client, clinicId, { professionalId, status: 'pendente' });
  assert(list.length === 1 && list[0].id === shift3.id, 'listagem filtra corretamente por status pendente');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
