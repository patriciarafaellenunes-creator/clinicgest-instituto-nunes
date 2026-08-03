// test/leads-budgets.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const leadsService = require('../src/services/leadsService');
const budgetsService = require('../src/services/budgetsService');
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
  const patientId = randomUUID();
  const procedureId = randomUUID();
  const bankAccountId = randomUUID();
  const paymentMethodId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Facetas de resina', 1000)`, [procedureId, clinicId]);
  await client.query(`INSERT INTO bank_accounts (id, clinic_id, name, current_balance) VALUES ($1,$2,'Conta Principal', 0)`, [bankAccountId, clinicId]);
  await client.query(`INSERT INTO payment_methods (id, clinic_id, name) VALUES ($1,$2,'Cartão de crédito')`, [paymentMethodId, clinicId]);

  console.log('\n== Teste: CRM de Leads ==');

  const lead = await leadsService.createLead(client, {
    clinicId, unitId, fullName: 'Carla Souza', phone: '41988887777',
    procedureInterest: 'Facetas', source: 'instagram', potentialValue: 4000, userId,
  });
  assert(lead.status === 'novo_lead', 'lead criado na primeira etapa do funil');

  await leadsService.updateLeadStatus(client, { id: lead.id, clinicId, userId, status: 'primeiro_contato' });
  await leadsService.updateLeadStatus(client, { id: lead.id, clinicId, userId, status: 'avaliacao_agendada' });
  await leadsService.updateLeadStatus(client, { id: lead.id, clinicId, userId, status: 'avaliacao_realizada' });
  const presented = await leadsService.updateLeadStatus(client, { id: lead.id, clinicId, userId, status: 'orcamento_apresentado' });
  assert(presented.status === 'orcamento_apresentado', 'lead avança pelas etapas do funil');

  let lossBlocked = false;
  try {
    await leadsService.updateLeadStatus(client, { id: lead.id, clinicId, userId, status: 'perdido' });
  } catch (err) {
    lossBlocked = err.code === 'LOSS_REASON_REQUIRED';
  }
  assert(lossBlocked, 'marcar lead como perdido sem motivo é bloqueado');

  const funnel = await leadsService.getFunnelSummary(client, clinicId);
  assert(funnel.byStage.orcamento_apresentado.count === 1, 'resumo do funil contabiliza a etapa correta');

  const allLeads = await leadsService.listLeads(client, clinicId);
  assert(allLeads.length === 1 && allLeads[0].full_name === 'Carla Souza', 'listagem geral de leads retorna o lead criado');
  const filteredLeads = await leadsService.listLeads(client, clinicId, { status: 'orcamento_apresentado' });
  assert(filteredLeads.length === 1, 'listagem filtrada por etapa funciona');
  const emptyFilter = await leadsService.listLeads(client, clinicId, { status: 'fechado' });
  assert(emptyFilter.length === 0, 'listagem filtrada por etapa sem correspondência retorna vazio');

  assert(funnel.conversionRate === null, 'taxa de conversão é nula quando nenhum lead chegou a etapa final (fechado ou perdido)');

  const secondLead = await leadsService.createLead(client, { clinicId, unitId, fullName: 'Outro Lead', userId });
  await leadsService.updateLeadStatus(client, { id: secondLead.id, clinicId, userId, status: 'perdido', lossReason: 'Sem retorno' });
  const funnelAfterLoss = await leadsService.getFunnelSummary(client, clinicId);
  assert(funnelAfterLoss.conversionRate === 0, 'com 1 lead perdido e 0 fechados, taxa de conversão é 0% (não 100%)');

  console.log('\n== Teste: Orçamento com desconto acima do limite ==');

  let discountBlocked = false;
  try {
    await budgetsService.createBudget(client, {
      clinicId, unitId, patientId, userId,
      items: [{ procedureId, quantity: 4, unitPrice: 1000, discount: 800 }], // 20% de desconto, sem autorização
    });
  } catch (err) {
    discountBlocked = err.code === 'DISCOUNT_APPROVAL_REQUIRED';
  }
  assert(discountBlocked, 'desconto acima de 10% sem autorização é bloqueado');

  const budget = await budgetsService.createBudget(client, {
    clinicId, unitId, patientId, userId,
    items: [{ procedureId, quantity: 4, unitPrice: 1000, discount: 800 }],
    discountApprovedBy: userId, // agora com autorização
  });
  assert(Number(budget.total_amount) === 3200, `total do orçamento calculado corretamente (4000 - 800 = 3200, veio ${budget.total_amount})`);
  assert(budget.status === 'rascunho', 'orçamento criado como rascunho');

  await budgetsService.updateBudgetStatus(client, { id: budget.id, clinicId, userId, status: 'apresentado' });

  console.log('\n== Teste: Aprovação gera contrato + parcelas + contas a receber ==');

  const { budget: approvedBudget, contract, installments } = await budgetsService.approveBudget(client, {
    id: budget.id, clinicId, userId, unitId,
    installmentCount: 3, firstDueDate: '2026-08-01', paymentMethodId, bankAccountId, leadId: lead.id,
  });

  assert(approvedBudget.status === 'aprovado', 'orçamento aprovado');
  assert(contract.total_amount == 3200, 'contrato criado com o valor total do orçamento');
  assert(installments.length === 3, 'geradas 3 parcelas conforme solicitado');

  const sumInstallments = installments.reduce((acc, i) => acc + Number(i.amount), 0);
  assert(Math.abs(sumInstallments - 3200) < 0.01, `soma das parcelas bate com o total (veio ${sumInstallments})`);

  const { rows: receivables } = await client.query(
    `SELECT * FROM accounts_receivable WHERE patient_id = $1 ORDER BY due_date`, [patientId]
  );
  assert(receivables.length === 3, 'contas a receber geradas automaticamente, uma por parcela');
  assert(receivables[0].due_date.toISOString().slice(0, 10) === '2026-08-01', 'primeira parcela com vencimento correto');
  assert(receivables[1].due_date.toISOString().slice(0, 10) === '2026-09-01', 'segunda parcela um mês depois');

  const closedLead = (await client.query(`SELECT * FROM leads WHERE id = $1`, [lead.id])).rows[0];
  assert(closedLead.status === 'fechado', 'lead vinculado é automaticamente marcado como fechado ao aprovar o orçamento');
  assert(closedLead.patient_id === patientId, 'lead vinculado ao paciente');

  const budgetsList = await budgetsService.listBudgets(client, clinicId);
  assert(budgetsList.length === 1 && budgetsList[0].patient_name === 'Paciente Teste', 'listagem de orçamentos traz o nome do paciente');
  const approvedOnly = await budgetsService.listBudgets(client, clinicId, { status: 'aprovado' });
  assert(approvedOnly.length === 1, 'listagem filtrada por status "aprovado" funciona');

  console.log('\n== Teste: Financeiro enxerga as parcelas geradas pelo orçamento ==');

  await financialService.receivePayment(client, {
    id: receivables[0].id, clinicId, userId, receivedAmount: Number(receivables[0].amount), bankAccountId,
  });
  const dashboard = await financialService.getDashboardSummary(client, clinicId, { periodStart: '2026-01-01', periodEnd: '2026-12-31' });
  assert(dashboard.revenueReceived === Number(receivables[0].amount), `dashboard financeiro reflete o recebimento vindo do orçamento (veio ${dashboard.revenueReceived})`);

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
