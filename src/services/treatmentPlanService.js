// src/services/treatmentPlanService.js
//
// Plano de tratamento é sobre CLÍNICA (o que tratar, em que ordem, com que
// prioridade) — orçamento (budgetsService) é sobre DINHEIRO (quanto custa,
// como parcelar). Este service não duplica a lógica financeira: quando o
// paciente aceita os itens, convertAcceptedItemsToBudget monta a lista de
// itens e chama budgetsService.createBudget, exatamente como um atendente
// faria manualmente — só que automático e rastreável (o orçamento guarda
// treatment_plan_id, então dá pra sempre voltar do orçamento pro plano
// clínico que o originou).

const { logAudit } = require('./auditService');
const budgetsService = require('./budgetsService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_PRIORITIES = ['alta', 'media', 'baixa'];

async function createTreatmentPlan(client, { clinicId, patientId, professionalId, notes, items, userId }) {
  if (!items || items.length === 0) throw new DomainError('Plano de tratamento precisa de ao menos um item.', 'EMPTY_PLAN');
  for (const item of items) {
    if (item.priority && !VALID_PRIORITIES.includes(item.priority)) {
      throw new DomainError(`Prioridade inválida: ${item.priority}`, 'INVALID_PRIORITY');
    }
  }

  const { rows } = await client.query(
    `INSERT INTO treatment_plans (clinic_id, patient_id, professional_id, status, notes, created_by)
     VALUES ($1,$2,$3,'rascunho',$4,$5) RETURNING *`,
    [clinicId, patientId, professionalId, notes || null, userId]
  );
  const plan = rows[0];

  for (const item of items) {
    await client.query(
      `INSERT INTO treatment_plan_items
        (treatment_plan_id, procedure_id, tooth_or_region, phase, priority, sequence_order,
         estimated_duration_minutes, lab_required, clinical_cost, charged_value, is_alternative_of, patient_decision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pendente')`,
      [plan.id, item.procedureId, item.toothOrRegion || null, item.phase || 1, item.priority || 'media',
       item.sequenceOrder || null, item.estimatedDurationMinutes || null, !!item.labRequired,
       item.clinicalCost || null, item.chargedValue, item.isAlternativeOf || null]
    );
  }

  await logAudit(client, { clinicId, userId, tableName: 'treatment_plans', recordId: plan.id, action: 'insert', afterValue: plan });
  return plan;
}

/** Lista os planos de tratamento de um paciente — usado pela tela de Planos de Tratamento. */
async function getPatientTreatmentPlans(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT tp.*, pr.full_name AS professional_name FROM treatment_plans tp
     JOIN professionals pr ON pr.id = tp.professional_id
     WHERE tp.clinic_id = $1 AND tp.patient_id = $2 ORDER BY tp.created_at DESC`,
    [clinicId, patientId]
  );
  return rows;
}

async function getTreatmentPlanWithItems(client, clinicId, planId) {
  const { rows: planRows } = await client.query(`SELECT * FROM treatment_plans WHERE id = $1 AND clinic_id = $2`, [planId, clinicId]);
  const plan = planRows[0];
  if (!plan) throw new DomainError('Plano de tratamento não encontrado.', 'NOT_FOUND');

  const { rows: items } = await client.query(
    `SELECT tpi.*, p.name AS procedure_name FROM treatment_plan_items tpi
     JOIN procedures p ON p.id = tpi.procedure_id WHERE tpi.treatment_plan_id = $1
     ORDER BY tpi.phase, tpi.sequence_order NULLS LAST`,
    [planId]
  );
  return { ...plan, items };
}

async function updatePlanStatus(client, { id, clinicId, userId, status }) {
  const allowed = ['apresentado', 'aprovado', 'parcialmente_aprovado', 'recusado', 'cancelado', 'concluido'];
  if (!allowed.includes(status)) throw new DomainError(`Status inválido: ${status}`, 'INVALID_STATUS');

  const { rows: beforeRows } = await client.query(`SELECT * FROM treatment_plans WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Plano de tratamento não encontrado.', 'NOT_FOUND');
  if (['cancelado', 'concluido'].includes(before.status)) {
    throw new DomainError(`Plano em status final ("${before.status}") não pode ser alterado.`, 'INVALID_TRANSITION');
  }

  const { rows } = await client.query(`UPDATE treatment_plans SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
  await logAudit(client, { clinicId, userId, tableName: 'treatment_plans', recordId: id, action: 'update_status', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

/** Registra a decisão do paciente sobre um item específico do plano (aceito ou recusado). */
async function recordItemDecision(client, { itemId, clinicId, userId, decision, reason }) {
  if (!['aceito', 'recusado'].includes(decision)) throw new DomainError(`Decisão inválida: ${decision}`, 'INVALID_DECISION');
  if (decision === 'recusado' && !reason) throw new DomainError('Motivo da recusa é obrigatório.', 'REASON_REQUIRED');

  const { rows: itemRows } = await client.query(
    `SELECT tpi.*, tp.clinic_id FROM treatment_plan_items tpi
     JOIN treatment_plans tp ON tp.id = tpi.treatment_plan_id WHERE tpi.id = $1 AND tp.clinic_id = $2`,
    [itemId, clinicId]
  );
  const item = itemRows[0];
  if (!item) throw new DomainError('Item do plano de tratamento não encontrado.', 'NOT_FOUND');

  const { rows } = await client.query(
    `UPDATE treatment_plan_items SET patient_decision = $1, decision_reason = $2 WHERE id = $3 RETURNING *`,
    [decision, decision === 'recusado' ? reason : null, itemId]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'treatment_plan_items', recordId: itemId, action: 'record_decision',
    beforeValue: item, afterValue: rows[0],
  });

  return rows[0];
}

/**
 * Converte os itens ACEITOS de um plano em um orçamento de verdade,
 * reaproveitando budgetsService (sem duplicar cálculo de total/desconto).
 * Itens recusados ou ainda pendentes ficam de fora — só o que o paciente
 * já aceitou vira orçamento.
 */
async function convertAcceptedItemsToBudget(client, { planId, clinicId, unitId, userId, discountApprovedBy }) {
  const plan = await getTreatmentPlanWithItems(client, clinicId, planId);

  const acceptedItems = plan.items.filter((i) => i.patient_decision === 'aceito');
  if (acceptedItems.length === 0) {
    throw new DomainError('Nenhum item do plano foi aceito pelo paciente ainda.', 'NO_ACCEPTED_ITEMS');
  }

  const budgetItems = acceptedItems.map((i) => ({
    procedureId: i.procedure_id,
    quantity: 1,
    unitPrice: Number(i.charged_value),
    discount: 0,
  }));

  const budget = await budgetsService.createBudget(client, {
    clinicId, unitId, patientId: plan.patient_id, professionalId: plan.professional_id,
    items: budgetItems, userId, discountApprovedBy,
  });

  await client.query(`UPDATE budgets SET treatment_plan_id = $1 WHERE id = $2`, [planId, budget.id]);

  await logAudit(client, {
    clinicId, userId, tableName: 'treatment_plans', recordId: planId, action: 'convert_to_budget',
    afterValue: { budgetId: budget.id, itemsConverted: acceptedItems.length },
  });

  return { ...budget, treatment_plan_id: planId };
}

module.exports = {
  DomainError, VALID_PRIORITIES,
  createTreatmentPlan, getPatientTreatmentPlans, getTreatmentPlanWithItems, updatePlanStatus,
  recordItemDecision, convertAcceptedItemsToBudget,
};
