// src/services/patientsService.js
//
// Regra central (seção 5 do briefing): evitar duplicidade de paciente por
// CPF, telefone e e-mail. CPF já tem UNIQUE(clinic_id, cpf) no banco — isso
// garante a regra mesmo se dois cadastros chegarem ao mesmo tempo (a
// constraint do banco é a fonte de verdade, não uma checagem só na aplicação).
// Telefone/e-mail duplicado não bloqueia (pode ser família usando o mesmo
// contato), mas o sistema avisa para o atendente decidir.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

function onlyDigits(str) {
  return (str || '').replace(/\D/g, '');
}

async function findPossibleDuplicates(client, clinicId, { cpf, phone, email }) {
  const conditions = [];
  const params = [clinicId];
  let i = 2;

  if (cpf) { conditions.push(`cpf = $${i++}`); params.push(onlyDigits(cpf)); }
  if (phone) { conditions.push(`phone = $${i++} OR whatsapp = $${i++}`); params.push(onlyDigits(phone), onlyDigits(phone)); }
  if (email) { conditions.push(`lower(email) = lower($${i++})`); params.push(email); }

  if (conditions.length === 0) return [];

  const { rows } = await client.query(
    `SELECT id, full_name, cpf, phone, email FROM patients
     WHERE clinic_id = $1 AND (${conditions.join(' OR ')}) AND is_active = true`,
    params
  );
  return rows;
}

async function createPatient(client, {
  clinicId, unitId, fullName, cpf, birthDate, phone, whatsapp, email, address,
  financialGuardian, source, responsibleProfessionalId, notes, userId,
  forceCreateDespiteDuplicate = false,
}) {
  if (!fullName || !fullName.trim()) {
    throw new DomainError('Nome é obrigatório.', 'INVALID_NAME');
  }

  const duplicates = await findPossibleDuplicates(client, clinicId, { cpf, phone: phone || whatsapp, email });
  if (duplicates.length > 0 && !forceCreateDespiteDuplicate) {
    throw new DomainError(
      'Paciente com CPF, telefone ou e-mail já cadastrado. Confirme antes de criar um novo registro.',
      'POSSIBLE_DUPLICATE'
    );
  }

  const { rows } = await client.query(
    `INSERT INTO patients
      (clinic_id, unit_id, full_name, cpf, birth_date, phone, whatsapp, email, address,
       financial_guardian, source, responsible_professional_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [clinicId, unitId, fullName.trim(), cpf ? onlyDigits(cpf) : null, birthDate || null,
     phone ? onlyDigits(phone) : null, whatsapp ? onlyDigits(whatsapp) : null, email || null,
     address || null, financialGuardian || null, source || null, responsibleProfessionalId || null, notes || null]
  );
  const record = rows[0];

  await logAudit(client, {
    clinicId, userId, tableName: 'patients', recordId: record.id, action: 'insert', afterValue: record,
  });

  return record;
}

async function updatePatient(client, { id, clinicId, userId, ...fields }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM patients WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Paciente não encontrado.', 'NOT_FOUND');

  const allowed = ['full_name', 'phone', 'whatsapp', 'email', 'address', 'financial_guardian', 'notes', 'is_active'];
  const setClauses = [];
  const params = [];
  let i = 1;

  const camelToSnake = { fullName: 'full_name', financialGuardian: 'financial_guardian', isActive: 'is_active' };
  for (const [key, value] of Object.entries(fields)) {
    const column = camelToSnake[key] || key;
    if (!allowed.includes(column)) continue;
    setClauses.push(`${column} = $${i++}`);
    params.push(value);
  }
  if (setClauses.length === 0) return before;

  params.push(id, clinicId);
  const { rows } = await client.query(
    `UPDATE patients SET ${setClauses.join(', ')} WHERE id = $${i++} AND clinic_id = $${i} RETURNING *`,
    params
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'patients', recordId: id, action: 'update', beforeValue: before, afterValue: rows[0],
  });

  return rows[0];
}

async function searchPatients(client, clinicId, { query, limit = 20 }) {
  const { rows } = await client.query(
    `SELECT id, full_name, cpf, phone, email FROM patients
     WHERE clinic_id = $1 AND is_active = true
       AND (full_name ILIKE $2 OR cpf = $3 OR phone = $3)
     ORDER BY full_name LIMIT $4`,
    [clinicId, `%${query}%`, onlyDigits(query), limit]
  );
  return rows;
}

async function getPatientProfile(client, clinicId, patientId) {
  const { rows } = await client.query(`SELECT * FROM patients WHERE id = $1 AND clinic_id = $2`, [patientId, clinicId]);
  const patient = rows[0];
  if (!patient) throw new DomainError('Paciente não encontrado.', 'NOT_FOUND');

  const [{ rows: appointments }, { rows: budgets }, { rows: receivable }] = await Promise.all([
    client.query(`SELECT id, starts_at, status FROM appointments WHERE patient_id = $1 ORDER BY starts_at DESC LIMIT 10`, [patientId]),
    client.query(`SELECT id, status, total_amount, created_at FROM budgets WHERE patient_id = $1 ORDER BY created_at DESC`, [patientId]),
    client.query(
      `SELECT COALESCE(SUM(amount - received_amount), 0) AS pending
       FROM accounts_receivable WHERE patient_id = $1 AND status NOT IN ('pago','cancelado','estornado')`,
      [patientId]
    ),
  ]);

  return {
    ...patient,
    recentAppointments: appointments,
    budgets,
    pendingBalance: Number(receivable[0].pending),
  };
}

module.exports = { DomainError, findPossibleDuplicates, createPatient, updatePatient, searchPatients, getPatientProfile };
