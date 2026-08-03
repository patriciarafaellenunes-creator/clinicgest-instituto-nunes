// src/services/labOrderService.js
//
// Rastreamento de trabalhos enviados a laboratórios (documento 2, seção
// "Laboratórios e próteses"). Quando um trabalho é finalizado, o custo vira
// uma conta a pagar de verdade — reaproveitando financialService, mesma
// filosofia usada em purchasingService: este módulo não reimplementa nada
// do financeiro, só chama na hora certa.

const { logAudit } = require('./auditService');
const financialService = require('./financialService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_STATUSES = [
  'solicitacao_criada', 'moldagem_pendente', 'enviado', 'em_producao', 'prova_agendada',
  'ajuste_solicitado', 'reenviado', 'recebido', 'instalado', 'finalizado', 'cancelado',
];

async function createLabOrder(client, {
  clinicId, patientId, professionalId, supplierId, workType, toothOrRegion, color, material,
  cost, sentAt, expectedDeliveryDate, notes, relatedTreatmentPlanItemId, userId,
}) {
  if (!workType || !workType.trim()) throw new DomainError('Tipo de trabalho é obrigatório.', 'MISSING_WORK_TYPE');

  const { rows } = await client.query(
    `INSERT INTO lab_orders
      (clinic_id, patient_id, professional_id, supplier_id, work_type, tooth_or_region, color, material,
       cost, sent_at, expected_delivery_date, notes, related_treatment_plan_item_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'solicitacao_criada',$14)
     RETURNING *`,
    [clinicId, patientId, professionalId, supplierId, workType.trim(), toothOrRegion || null, color || null,
     material || null, cost || null, sentAt || null, expectedDeliveryDate || null, notes || null,
     relatedTreatmentPlanItemId || null, userId]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'lab_orders', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

async function updateLabOrderStatus(client, { id, clinicId, userId, status, receivedAt }) {
  if (!VALID_STATUSES.includes(status)) throw new DomainError(`Status inválido: ${status}`, 'INVALID_STATUS');

  const { rows: beforeRows } = await client.query(`SELECT * FROM lab_orders WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Trabalho de laboratório não encontrado.', 'NOT_FOUND');
  if (['finalizado', 'cancelado'].includes(before.status)) {
    throw new DomainError(`Trabalho em status final ("${before.status}") não pode ser alterado.`, 'INVALID_TRANSITION');
  }

  const shouldSetReceivedAt = status === 'recebido' && !before.received_at;
  const { rows } = await client.query(
    `UPDATE lab_orders SET status = $1, received_at = COALESCE($2, received_at) WHERE id = $3 RETURNING *`,
    [status, shouldSetReceivedAt ? (receivedAt || new Date().toISOString().slice(0, 10)) : null, id]
  );

  await logAudit(client, { clinicId, userId, tableName: 'lab_orders', recordId: id, action: 'update_status', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

/** Finaliza o trabalho e gera a conta a pagar correspondente ao laboratório, na mesma transação. */
async function finalizeLabOrder(client, { id, clinicId, userId, dueDate, categoryId, costCenterId, bankAccountId }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM lab_orders WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Trabalho de laboratório não encontrado.', 'NOT_FOUND');
  if (before.status === 'finalizado') throw new DomainError('Trabalho já está finalizado.', 'ALREADY_FINALIZED');
  if (before.status === 'cancelado') throw new DomainError('Trabalho cancelado não pode ser finalizado.', 'INVALID_TRANSITION');
  if (!before.cost || Number(before.cost) <= 0) throw new DomainError('Trabalho sem custo definido não pode gerar conta a pagar.', 'MISSING_COST');
  if (!dueDate) throw new DomainError('Data de vencimento da conta a pagar é obrigatória.', 'MISSING_DUE_DATE');

  const { rows: supplierRows } = await client.query(`SELECT legal_name FROM suppliers WHERE id = $1`, [before.supplier_id]);
  const supplierName = supplierRows[0] ? supplierRows[0].legal_name : 'Laboratório';

  const accountPayable = await financialService.createAccountPayable(client, {
    clinicId, unitId: null, supplierId: before.supplier_id, bankAccountId: bankAccountId || null,
    categoryId: categoryId || null, costCenterId: costCenterId || null,
    description: `Trabalho laboratorial — ${before.work_type} — ${supplierName} (pedido ${id})`,
    competenceDate: new Date().toISOString().slice(0, 10), dueDate, amount: before.cost, isRecurring: false, userId,
  });

  const { rows: updated } = await client.query(
    `UPDATE lab_orders SET status = 'finalizado', accounts_payable_id = $1 WHERE id = $2 RETURNING *`,
    [accountPayable.id, id]
  );

  await logAudit(client, { clinicId, userId, tableName: 'lab_orders', recordId: id, action: 'finalize', beforeValue: before, afterValue: updated[0] });
  return { labOrder: updated[0], accountPayable };
}

/** Trabalhos com previsão de entrega vencida e ainda não recebidos/finalizados/cancelados — a base do alerta de atraso. */
async function getOverdueLabOrders(client, clinicId) {
  const { rows } = await client.query(
    `SELECT lo.*, p.full_name AS patient_name, s.legal_name AS supplier_name
     FROM lab_orders lo
     JOIN patients p ON p.id = lo.patient_id
     JOIN suppliers s ON s.id = lo.supplier_id
     WHERE lo.clinic_id = $1 AND lo.expected_delivery_date < CURRENT_DATE
       AND lo.status NOT IN ('recebido', 'instalado', 'finalizado', 'cancelado')
     ORDER BY lo.expected_delivery_date ASC`,
    [clinicId]
  );
  return rows;
}

/** Lista todos os trabalhos de laboratório da clínica — usado pela tela de Laboratórios. */
async function listLabOrders(client, clinicId) {
  const { rows } = await client.query(
    `SELECT lo.*, p.full_name AS patient_name, pr.full_name AS professional_name, s.legal_name AS supplier_name
     FROM lab_orders lo
     JOIN patients p ON p.id = lo.patient_id
     JOIN professionals pr ON pr.id = lo.professional_id
     JOIN suppliers s ON s.id = lo.supplier_id
     WHERE lo.clinic_id = $1 ORDER BY lo.created_at DESC`,
    [clinicId]
  );
  return rows;
}

async function getPatientLabOrders(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT * FROM lab_orders WHERE clinic_id = $1 AND patient_id = $2 ORDER BY created_at DESC`,
    [clinicId, patientId]
  );
  return rows;
}

module.exports = {
  DomainError, VALID_STATUSES,
  createLabOrder, updateLabOrderStatus, finalizeLabOrder, listLabOrders, getOverdueLabOrders, getPatientLabOrders,
};
