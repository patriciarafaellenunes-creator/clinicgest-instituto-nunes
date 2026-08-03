// src/services/agendaService.js
//
// Regras centrais (seção 4 do briefing):
//   - Não pode haver conflito de horário para o mesmo profissional.
//   - Não pode haver conflito de horário para a mesma sala.
//   - O sistema deve alertar (não necessariamente bloquear) quando o paciente
//     está inadimplente ou com pendência — aqui optamos por alertar e deixar
//     a recepção decidir, em vez de travar (ver regra de negócio no plano
//     mestre, seção 7: bloqueio automático rígido atrapalha exceções legítimas).

const { logAudit } = require('./auditService');
const clinicalRecordsService = require('./clinicalRecordsService');
const professionalContractService = require('./professionalContractService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_STATUSES = [
  'agendado', 'confirmado', 'em_espera', 'em_atendimento',
  'finalizado', 'reagendado', 'cancelado', 'faltou',
];

async function checkConflicts(client, { professionalId, roomId, startsAt, endsAt, excludeAppointmentId }) {
  const conflicts = { professional: false, room: false };

  const { rows: profRows } = await client.query(
    `SELECT id FROM appointments
     WHERE professional_id = $1
       AND status NOT IN ('cancelado', 'faltou', 'finalizado')
       AND starts_at < $2 AND ends_at > $3
       AND ($4::uuid IS NULL OR id != $4)`,
    [professionalId, endsAt, startsAt, excludeAppointmentId || null]
  );
  conflicts.professional = profRows.length > 0;

  if (roomId) {
    const { rows: roomRows } = await client.query(
      `SELECT id FROM appointments
       WHERE room_id = $1
         AND status NOT IN ('cancelado', 'faltou', 'finalizado')
         AND starts_at < $2 AND ends_at > $3
         AND ($4::uuid IS NULL OR id != $4)`,
      [roomId, endsAt, startsAt, excludeAppointmentId || null]
    );
    conflicts.room = roomRows.length > 0;
  }

  return conflicts;
}

async function getPatientAlerts(client, clinicId, patientId) {
  if (!patientId) return [];
  const alerts = [];

  const { rows: overdue } = await client.query(
    `SELECT COALESCE(SUM(amount - received_amount), 0) AS total FROM accounts_receivable
     WHERE clinic_id = $1 AND patient_id = $2 AND status NOT IN ('pago','cancelado','estornado') AND due_date < CURRENT_DATE`,
    [clinicId, patientId]
  );
  if (Number(overdue[0].total) > 0) {
    alerts.push({ type: 'inadimplencia', message: `Paciente possui R$ ${Number(overdue[0].total).toFixed(2)} em atraso.` });
  }

  const clinicalAlerts = await clinicalRecordsService.getClinicalAlerts(client, clinicId, patientId);
  alerts.push(...clinicalAlerts);

  return alerts;
}

async function createAppointment(client, {
  clinicId, unitId, patientId, leadId, professionalId, roomId, procedureId,
  startsAt, endsAt, userId, forceDespiteConflict = false,
}) {
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw new DomainError('Horário de término deve ser após o horário de início.', 'INVALID_TIME_RANGE');
  }
  if (!patientId && !leadId) {
    throw new DomainError('Agendamento precisa de um paciente ou lead vinculado.', 'MISSING_SUBJECT');
  }

  const conflicts = await checkConflicts(client, { professionalId, roomId, startsAt, endsAt });
  if ((conflicts.professional || conflicts.room) && !forceDespiteConflict) {
    const parts = [];
    if (conflicts.professional) parts.push('profissional já tem outro atendimento nesse horário');
    if (conflicts.room) parts.push('sala já está ocupada nesse horário');
    throw new DomainError(`Conflito de agenda: ${parts.join('; ')}.`, 'SCHEDULE_CONFLICT');
  }

  if (procedureId) {
    const { rows: procRows } = await client.query(`SELECT specialty FROM procedures WHERE id = $1`, [procedureId]);
    const specialty = procRows[0] ? procRows[0].specialty : null;

    const authCheck = await professionalContractService.isProfessionalAuthorized(client, clinicId, professionalId, { procedureId, specialty });
    if (authCheck.hasContract && !authCheck.authorized) {
      throw new DomainError(
        'Profissional não está autorizado para este procedimento segundo o contrato vigente.',
        'PROFESSIONAL_NOT_AUTHORIZED'
      );
    }
  }

  const { rows } = await client.query(
    `INSERT INTO appointments
      (clinic_id, unit_id, patient_id, lead_id, professional_id, room_id, procedure_id, starts_at, ends_at, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'agendado',$10)
     RETURNING *`,
    [clinicId, unitId, patientId || null, leadId || null, professionalId, roomId || null, procedureId || null, startsAt, endsAt, userId]
  );
  const record = rows[0];

  await logAudit(client, {
    clinicId, userId, tableName: 'appointments', recordId: record.id, action: 'insert', afterValue: record,
  });

  const alerts = await getPatientAlerts(client, clinicId, patientId);

  return { appointment: record, alerts };
}

async function updateAppointmentStatus(client, { id, clinicId, userId, status, cancelReason }) {
  if (!VALID_STATUSES.includes(status)) {
    throw new DomainError(`Status inválido: ${status}`, 'INVALID_STATUS');
  }

  const { rows: beforeRows } = await client.query(`SELECT * FROM appointments WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Agendamento não encontrado.', 'NOT_FOUND');
  if (before.status === 'finalizado') {
    throw new DomainError('Não é possível alterar um atendimento já finalizado.', 'INVALID_STATUS_TRANSITION');
  }

  const { rows } = await client.query(
    `UPDATE appointments SET status = $1, cancel_reason = $2 WHERE id = $3 RETURNING *`,
    [status, status === 'cancelado' || status === 'faltou' ? (cancelReason || null) : before.cancel_reason, id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'appointments', recordId: id, action: 'update_status', beforeValue: before, afterValue: rows[0],
  });

  return rows[0];
}

async function rescheduleAppointment(client, { id, clinicId, userId, startsAt, endsAt, forceDespiteConflict = false }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM appointments WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Agendamento não encontrado.', 'NOT_FOUND');

  const conflicts = await checkConflicts(client, {
    professionalId: before.professional_id, roomId: before.room_id, startsAt, endsAt, excludeAppointmentId: id,
  });
  if ((conflicts.professional || conflicts.room) && !forceDespiteConflict) {
    throw new DomainError('Conflito de agenda no novo horário.', 'SCHEDULE_CONFLICT');
  }

  const { rows } = await client.query(
    `UPDATE appointments SET starts_at = $1, ends_at = $2, status = 'reagendado' WHERE id = $3 RETURNING *`,
    [startsAt, endsAt, id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'appointments', recordId: id, action: 'reschedule', beforeValue: before, afterValue: rows[0],
  });

  return rows[0];
}

async function getAgendaByProfessional(client, clinicId, { professionalId, date }) {
  const { rows } = await client.query(
    `SELECT a.*, p.full_name AS patient_name, l.full_name AS lead_name, pr.name AS procedure_name
     FROM appointments a
     LEFT JOIN patients p ON p.id = a.patient_id
     LEFT JOIN leads l ON l.id = a.lead_id
     LEFT JOIN procedures pr ON pr.id = a.procedure_id
     WHERE a.clinic_id = $1 AND a.professional_id = $2
       AND a.starts_at::date = $3::date
     ORDER BY a.starts_at`,
    [clinicId, professionalId, date]
  );
  return rows;
}

async function getIdleSlots(client, clinicId, { professionalId, date, workStart = '08:00', workEnd = '18:00', slotMinutes = 30 }) {
  const appointments = await getAgendaByProfessional(client, clinicId, { professionalId, date });
  const busy = appointments
    .filter((a) => !['cancelado', 'faltou'].includes(a.status))
    .map((a) => ({ start: new Date(a.starts_at), end: new Date(a.ends_at) }));

  const dayStart = new Date(`${date}T${workStart}:00`);
  const dayEnd = new Date(`${date}T${workEnd}:00`);
  const idle = [];
  let cursor = new Date(dayStart);

  while (cursor < dayEnd) {
    const slotEnd = new Date(cursor.getTime() + slotMinutes * 60000);
    const overlaps = busy.some((b) => cursor < b.end && slotEnd > b.start);
    if (!overlaps) idle.push({ start: new Date(cursor), end: slotEnd });
    cursor = slotEnd;
  }
  return idle;
}

module.exports = {
  DomainError,
  VALID_STATUSES,
  checkConflicts,
  getPatientAlerts,
  createAppointment,
  updateAppointmentStatus,
  rescheduleAppointment,
  getAgendaByProfessional,
  getIdleSlots,
};
