// test/financial.test.js
// Roda o schema real (02-schema-mvp.sql) contra um Postgres em memória (pg-mem)
// e exercita o financialService de ponta a ponta: cria conta a pagar, aprova,
// paga, confirma que o saldo do banco e o cash_ledger batem, e que baixa em
// duplicidade é bloqueada. Mesmo teste para contas a receber.

const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
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
    impure: true, // evita que o pg-mem cacheie/reuse o valor como se fosse uma constante
  });

  let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  // pg-mem não suporta a extensão pgcrypto nem RLS/policies (comentado no schema) — remover linha da extensão
  schema = schema.replace(/CREATE EXTENSION.*\n/g, '');

  db.public.none(schema);

  const { Client } = db.adapters.createPg();
  const client = new Client();
  await client.connect();
  // pg-mem exige transações explícitas via query — simulamos BEGIN/COMMIT no withClient manual abaixo
  client.query('BEGIN'); // no-op state tracker for pg-mem, real behavior handled per-statement

  // ---- Seed mínimo: company -> clinic -> unit -> bank_account -> supplier -> patient ----
  const companyId = require('crypto').randomUUID();
  const clinicId = require('crypto').randomUUID();
  const unitId = require('crypto').randomUUID();
  const bankAccountId = require('crypto').randomUUID();
  const supplierId = require('crypto').randomUUID();
  const patientId = require('crypto').randomUUID();
  const userId = require('crypto').randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO bank_accounts (id, clinic_id, name, current_balance) VALUES ($1,$2,'Conta Principal', 1000)`, [bankAccountId, clinicId]);
  await client.query(`INSERT INTO suppliers (id, clinic_id, legal_name) VALUES ($1,$2,'Fornecedor X')`, [supplierId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name, cpf) VALUES ($1,$2,'Paciente Teste','12345678900')`, [patientId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);

  console.log('\n== Teste: Contas a pagar ==');

  const ap = await financialService.createAccountPayable(client, {
    clinicId, unitId, supplierId, bankAccountId, categoryId: null, costCenterId: null,
    description: 'Compra de material', competenceDate: '2026-07-01', dueDate: '2026-07-10',
    amount: 500, isRecurring: false, userId,
  });
  assert(ap.status === 'pendente', 'conta a pagar criada como pendente');

  const approved = await financialService.approveAccountPayable(client, { id: ap.id, clinicId, userId });
  assert(approved.status === 'aprovado', 'conta a pagar aprovada');

  await financialService.payAccountPayable(client, { id: ap.id, clinicId, userId, paidAmount: 500, bankAccountId, paidDate: '2026-07-10' });

  const { rows: bankAfterPay } = await client.query(`SELECT current_balance FROM bank_accounts WHERE id = $1`, [bankAccountId]);
  assert(Number(bankAfterPay[0].current_balance) === 500, `saldo do banco debitado corretamente (1000 - 500 = 500, veio ${bankAfterPay[0].current_balance})`);

  const { rows: ledgerRows } = await client.query(`SELECT * FROM cash_ledger WHERE source_id = $1`, [ap.id]);
  assert(ledgerRows.length === 1 && ledgerRows[0].entry_type === 'saida', 'lançamento de saída criado no cash_ledger');

  let blocked = false;
  try {
    await financialService.payAccountPayable(client, { id: ap.id, clinicId, userId, paidAmount: 100, bankAccountId });
  } catch (err) {
    blocked = err.code === 'DUPLICATE_PAYMENT';
  }
  assert(blocked, 'baixa em duplicidade é bloqueada');

  const { rows: auditRows } = await client.query(`SELECT * FROM audit_log WHERE record_id = $1 ORDER BY id`, [ap.id]);
  assert(auditRows.length === 3, `audit_log tem 1 registro por ação (insert, approve, pay) — veio ${auditRows.length}`);

  const payableList = await financialService.listAccountsPayable(client, clinicId);
  assert(payableList.length === 1 && payableList[0].supplier_name, 'listagem de contas a pagar traz o nome do fornecedor');
  const paidOnly = await financialService.listAccountsPayable(client, clinicId, { status: 'pago' });
  assert(paidOnly.length === 1, 'listagem filtrada por status funciona');

  console.log('\n== Teste: Contas a receber ==');

  const ar = await financialService.createAccountReceivable(client, {
    clinicId, unitId, patientId, installmentId: null, bankAccountId, categoryId: null, costCenterId: null,
    competenceDate: '2026-07-05', dueDate: '2026-07-15', amount: 800, userId,
  });

  await financialService.receivePayment(client, { id: ar.id, clinicId, userId, receivedAmount: 300, bankAccountId, receivedDate: '2026-07-06' });
  const partial = (await client.query(`SELECT * FROM accounts_receivable WHERE id = $1`, [ar.id])).rows[0];
  assert(partial.status === 'parcialmente_pago', 'baixa parcial atualiza status para parcialmente_pago');

  await financialService.receivePayment(client, { id: ar.id, clinicId, userId, receivedAmount: 500, bankAccountId, receivedDate: '2026-07-10' });
  const full = (await client.query(`SELECT * FROM accounts_receivable WHERE id = $1`, [ar.id])).rows[0];
  assert(full.status === 'pago', 'segunda baixa completa o pagamento');

  const { rows: bankFinal } = await client.query(`SELECT current_balance FROM bank_accounts WHERE id = $1`, [bankAccountId]);
  assert(Number(bankFinal[0].current_balance) === 1300, `saldo final do banco correto (500 + 300 + 500 = 1300, veio ${bankFinal[0].current_balance})`);

  const receivableList = await financialService.listAccountsReceivable(client, clinicId);
  assert(receivableList.length === 1 && receivableList[0].patient_name === 'Paciente Teste', 'listagem de contas a receber traz o nome do paciente');

  console.log('\n== Teste: Projeção de caixa ==');
  const projection = await financialService.getCashProjection(client, clinicId, 30);
  assert(projection.currentBalance === 1300, 'projeção parte do saldo atual correto');

  const dashboard = await financialService.getDashboardSummary(client, clinicId, { periodStart: '2026-07-01', periodEnd: '2026-07-31' });
  assert(dashboard.revenueReceived === 800, `dashboard soma recebido do período corretamente (veio ${dashboard.revenueReceived})`);

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
