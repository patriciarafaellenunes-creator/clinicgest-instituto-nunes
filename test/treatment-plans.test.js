// test/treatment-plans.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const treatmentPlanService = require('../src/services/treatmentPlanService');
const budgetsService = require('../src/services/budgetsService');

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
  const procedureRestauracao = randomUUID();
  const procedureImplante = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Restauração', 400)`, [procedureRestauracao, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Implante', 3500)`, [procedureImplante, clinicId]);

  console.log('\n== Teste: validações de criação ==');

  let invalidPriorityBlocked = false;
  try {
    await treatmentPlanService.createTreatmentPlan(client, {
      clinicId, patientId, professionalId, userId,
      items: [{ procedureId: procedureRestauracao, toothOrRegion: '26', chargedValue: 400, priority: 'urgentissima' }],
    });
  } catch (err) {
    invalidPriorityBlocked = err.code === 'INVALID_PRIORITY';
  }
  assert(invalidPriorityBlocked, 'prioridade fora da lista permitida é rejeitada');

  console.log('\n== Teste: criação do plano com múltiplos itens ==');

  const plan = await treatmentPlanService.createTreatmentPlan(client, {
    clinicId, patientId, professionalId, notes: 'Plano completo de reabilitação', userId,
    items: [
      { procedureId: procedureRestauracao, toothOrRegion: '26', phase: 1, priority: 'alta', sequenceOrder: 1, chargedValue: 400 },
      { procedureId: procedureImplante, toothOrRegion: '36', phase: 2, priority: 'media', sequenceOrder: 2, chargedValue: 3500, labRequired: true },
    ],
  });
  assert(plan.status === 'rascunho', 'plano criado como rascunho');

  const planWithItems = await treatmentPlanService.getTreatmentPlanWithItems(client, clinicId, plan.id);
  assert(planWithItems.items.length === 2, 'os 2 itens do plano foram salvos');
  assert(planWithItems.items[0].patient_decision === 'pendente', 'itens começam com decisão pendente');
  assert(planWithItems.items[0].phase === 1 && planWithItems.items[1].phase === 2, 'itens ordenados por fase');

  await treatmentPlanService.updatePlanStatus(client, { id: plan.id, clinicId, userId, status: 'apresentado' });

  console.log('\n== Teste: decisões do paciente item a item ==');

  const restauracaoItem = planWithItems.items.find((i) => i.procedure_id === procedureRestauracao);
  const implanteItem = planWithItems.items.find((i) => i.procedure_id === procedureImplante);

  let missingReasonBlocked = false;
  try {
    await treatmentPlanService.recordItemDecision(client, { itemId: implanteItem.id, clinicId, userId, decision: 'recusado' });
  } catch (err) {
    missingReasonBlocked = err.code === 'REASON_REQUIRED';
  }
  assert(missingReasonBlocked, 'recusar um item sem motivo é bloqueado');

  await treatmentPlanService.recordItemDecision(client, { itemId: restauracaoItem.id, clinicId, userId, decision: 'aceito' });
  const declinedImplant = await treatmentPlanService.recordItemDecision(client, {
    itemId: implanteItem.id, clinicId, userId, decision: 'recusado', reason: 'Paciente vai avaliar orçamento em outra clínica antes',
  });
  assert(declinedImplant.patient_decision === 'recusado' && declinedImplant.decision_reason, 'recusa registrada com motivo');

  console.log('\n== Teste: conversão dos itens aceitos em orçamento real ==');

  let noAcceptedBlocked = false;
  const emptyPlan = await treatmentPlanService.createTreatmentPlan(client, {
    clinicId, patientId, professionalId, userId,
    items: [{ procedureId: procedureRestauracao, chargedValue: 100 }],
  });
  try {
    await treatmentPlanService.convertAcceptedItemsToBudget(client, { planId: emptyPlan.id, clinicId, unitId, userId });
  } catch (err) {
    noAcceptedBlocked = err.code === 'NO_ACCEPTED_ITEMS';
  }
  assert(noAcceptedBlocked, 'conversão é bloqueada se nenhum item foi aceito ainda');

  const budget = await treatmentPlanService.convertAcceptedItemsToBudget(client, { planId: plan.id, clinicId, unitId, userId });
  assert(Number(budget.total_amount) === 400, `orçamento gerado só com o item aceito (restauração, R$400), não com o implante recusado (veio ${budget.total_amount})`);
  assert(budget.treatment_plan_id === plan.id, 'orçamento referencia o plano de tratamento que o originou');

  const budgetFromFinance = await budgetsService.getBudgetWithItems(client, clinicId, budget.id);
  assert(budgetFromFinance.items.length === 1 && budgetFromFinance.items[0].procedure_name === 'Restauração', 'financeiro enxerga o orçamento com o item correto, via o service já existente da Fase 1');

  const { rows: budgetRow } = await client.query(`SELECT treatment_plan_id FROM budgets WHERE id = $1`, [budget.id]);
  assert(budgetRow[0].treatment_plan_id === plan.id, 'vínculo orçamento -> plano de tratamento persistido no banco');

  const patientPlans = await treatmentPlanService.getPatientTreatmentPlans(client, clinicId, patientId);
  assert(patientPlans.length === 2 && patientPlans.every((p) => p.professional_name), 'listagem por paciente traz os dois planos, com nome do profissional');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
