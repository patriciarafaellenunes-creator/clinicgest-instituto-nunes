// src/services/leadsService.js
//
// Funil (seção 6 do briefing). O estado é uma máquina simples: cada lead tem
// um status dentro de FUNNEL_STAGES, e toda mudança de status é logada como
// uma interação automática, além do audit_log — assim o histórico do funil
// (quanto tempo em cada etapa) fica reconstruível sem depender só do log
// genérico de auditoria.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const FUNNEL_STAGES = [
  'novo_lead', 'primeiro_contato', 'em_atendimento', 'avaliacao_agendada',
  'avaliacao_confirmada', 'avaliacao_realizada', 'orcamento_apresentado',
  'em_negociacao', 'aguardando_decisao', 'fechado', 'perdido',
  'em_tratamento', 'pos_tratamento', 'reativacao',
];

const CLOSED_STAGES = ['fechado', 'perdido'];

async function createLead(client, {
  clinicId, unitId, fullName, phone, email, procedureInterest, source, campaign,
  assignedUserId, professionalId, potentialValue, userId,
}) {
  if (!fullName || !fullName.trim()) throw new DomainError('Nome é obrigatório.', 'INVALID_NAME');

  const { rows } = await client.query(
    `INSERT INTO leads
      (clinic_id, unit_id, full_name, phone, email, procedure_interest, source, campaign,
       assigned_user_id, professional_id, potential_value, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'novo_lead')
     RETURNING *`,
    [clinicId, unitId, fullName.trim(), phone || null, email || null, procedureInterest || null,
     source || null, campaign || null, assignedUserId || null, professionalId || null, potentialValue || null]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'leads', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

async function logInteraction(client, { leadId, clinicId, userId, interactionType, notes }) {
  const { rows: leadRows } = await client.query(`SELECT id FROM leads WHERE id = $1 AND clinic_id = $2`, [leadId, clinicId]);
  if (!leadRows[0]) throw new DomainError('Lead não encontrado.', 'NOT_FOUND');

  const { rows } = await client.query(
    `INSERT INTO lead_interactions (lead_id, user_id, interaction_type, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
    [leadId, userId, interactionType, notes || null]
  );
  return rows[0];
}

async function updateLeadStatus(client, { id, clinicId, userId, status, lossReason, nextAction, nextActionDate }) {
  if (!FUNNEL_STAGES.includes(status)) throw new DomainError(`Etapa de funil inválida: ${status}`, 'INVALID_STAGE');

  const { rows: beforeRows } = await client.query(`SELECT * FROM leads WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Lead não encontrado.', 'NOT_FOUND');
  if (CLOSED_STAGES.includes(before.status)) {
    throw new DomainError(`Lead já está em etapa final ("${before.status}") — reabra explicitamente antes de mudar.`, 'INVALID_TRANSITION');
  }
  if (status === 'perdido' && !lossReason) {
    throw new DomainError('Motivo de perda é obrigatório ao marcar o lead como perdido.', 'LOSS_REASON_REQUIRED');
  }

  const { rows } = await client.query(
    `UPDATE leads SET status = $1, loss_reason = $2, next_action = $3, next_action_date = $4 WHERE id = $5 RETURNING *`,
    [status, status === 'perdido' ? lossReason : before.loss_reason, nextAction || before.next_action,
     nextActionDate || before.next_action_date, id]
  );

  await logAudit(client, { clinicId, userId, tableName: 'leads', recordId: id, action: 'update_status', beforeValue: before, afterValue: rows[0] });
  await logInteraction(client, { leadId: id, clinicId, userId, interactionType: 'mudanca_status', notes: `${before.status} -> ${status}` });

  return rows[0];
}

/** Vincula o lead a um paciente já existente ou recém-criado (ex: ao agendar a avaliação). */
async function linkLeadToPatient(client, { leadId, patientId, clinicId, userId }) {
  const { rows } = await client.query(
    `UPDATE leads SET patient_id = $1 WHERE id = $2 AND clinic_id = $3 RETURNING *`,
    [patientId, leadId, clinicId]
  );
  if (!rows[0]) throw new DomainError('Lead não encontrado.', 'NOT_FOUND');

  await logAudit(client, { clinicId, userId, tableName: 'leads', recordId: leadId, action: 'link_patient', afterValue: rows[0] });
  return rows[0];
}

/** Lista os leads da clínica (opcionalmente filtrando por etapa) — usado pela tela de CRM. */
async function listLeads(client, clinicId, { status } = {}) {
  const conditions = ['clinic_id = $1'];
  const params = [clinicId];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }

  const { rows } = await client.query(
    `SELECT * FROM leads WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

/** Leads sem interação há mais de `hours` horas e ainda não fechados/perdidos. */
async function getStaleLeads(client, clinicId, hours = 48) {
  const { rows } = await client.query(
    `SELECT l.*, COALESCE(MAX(li.created_at), l.created_at) AS last_interaction_at
     FROM leads l
     LEFT JOIN lead_interactions li ON li.lead_id = l.id
     WHERE l.clinic_id = $1 AND l.status NOT IN ('fechado', 'perdido')
     GROUP BY l.id
     HAVING COALESCE(MAX(li.created_at), l.created_at) < now() - ($2 || ' hours')::interval
     ORDER BY last_interaction_at ASC`,
    [clinicId, hours]
  );
  return rows;
}

async function getFunnelSummary(client, clinicId) {
  const { rows } = await client.query(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(potential_value), 0) AS potential_total
     FROM leads WHERE clinic_id = $1 GROUP BY status`,
    [clinicId]
  );
  const byStage = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, { count: 0, potentialTotal: 0 }]));
  for (const row of rows) {
    byStage[row.status] = { count: Number(row.count), potentialTotal: Number(row.potential_total) };
  }

  // SUM(CASE WHEN ...) em vez de COUNT(*) FILTER (WHERE ...): o pg-mem usado
  // nos testes automatizados não avalia FILTER corretamente (ignora a
  // condição e conta todas as linhas) — descoberto testando esta função pela
  // primeira vez. Um Postgres real aceitaria FILTER sem problema, mas esta
  // forma funciona igual nos dois, então evita depender da diferença.
  const { rows: convRows } = await client.query(
    `SELECT
       SUM(CASE WHEN status = 'fechado' THEN 1 ELSE 0 END) AS closed,
       SUM(CASE WHEN status IN ('fechado','perdido') THEN 1 ELSE 0 END) AS decided
     FROM leads WHERE clinic_id = $1`,
    [clinicId]
  );
  const closed = Number(convRows[0].closed);
  const decided = Number(convRows[0].decided);

  return {
    byStage,
    conversionRate: decided > 0 ? closed / decided : null,
  };
}

module.exports = {
  DomainError, FUNNEL_STAGES, CLOSED_STAGES,
  createLead, logInteraction, updateLeadStatus, linkLeadToPatient, listLeads, getStaleLeads, getFunnelSummary,
};
