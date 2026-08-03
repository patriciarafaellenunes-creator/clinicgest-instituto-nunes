// src/services/proceduresService.js
//
// Cadastro básico de procedimentos (tabela de preços). Mesma lacuna que
// professionalsService fechava: a tabela `procedures` já era referenciada
// por agenda, orçamentos e planos de tratamento, mas nada na API permitia
// listar ou cadastrar um procedimento.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

async function listProcedures(client, clinicId) {
  const { rows } = await client.query(
    `SELECT id, name, default_price, avg_duration_minutes, specialty FROM procedures WHERE clinic_id = $1 ORDER BY name`,
    [clinicId]
  );
  return rows;
}

async function createProcedure(client, { clinicId, name, defaultPrice, avgDurationMinutes, specialty, userId }) {
  if (!name || !name.trim()) throw new DomainError('Nome do procedimento é obrigatório.', 'INVALID_NAME');

  const { rows } = await client.query(
    `INSERT INTO procedures (clinic_id, name, default_price, avg_duration_minutes, specialty)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [clinicId, name.trim(), defaultPrice || null, avgDurationMinutes || null, specialty || null]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'procedures', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

module.exports = { DomainError, listProcedures, createProcedure };
