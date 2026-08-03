// src/services/professionalsService.js
//
// Cadastro básico de profissionais. Até agora só existia a TABELA
// professionals (usada por agenda, orçamentos, diárias, contratos etc.) —
// nada na API permitia listar ou criar um profissional. Isso bloqueava
// qualquer tela que precise de um seletor "qual profissional" (Agenda,
// Orçamentos, Diárias, Equipe...).

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

async function listProfessionals(client, clinicId, { activeOnly = true } = {}) {
  const { rows } = await client.query(
    `SELECT id, full_name, professional_role, council_registration, registration_expiry, is_active
     FROM professionals WHERE clinic_id = $1 ${activeOnly ? 'AND is_active = true' : ''} ORDER BY full_name`,
    [clinicId]
  );
  return rows;
}

async function createProfessional(client, { clinicId, fullName, professionalRole, councilRegistration, registrationExpiry, userId }) {
  if (!fullName || !fullName.trim()) throw new DomainError('Nome é obrigatório.', 'INVALID_NAME');
  if (!professionalRole || !professionalRole.trim()) throw new DomainError('Função (ex.: dentista) é obrigatória.', 'INVALID_ROLE');

  const { rows } = await client.query(
    `INSERT INTO professionals (clinic_id, full_name, professional_role, council_registration, registration_expiry)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [clinicId, fullName.trim(), professionalRole.trim(), councilRegistration || null, registrationExpiry || null]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'professionals', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

module.exports = { DomainError, listProfessionals, createProfessional };
