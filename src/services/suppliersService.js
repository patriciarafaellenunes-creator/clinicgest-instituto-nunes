// src/services/suppliersService.js
//
// Cadastro básico de fornecedores. A tabela `suppliers` já era usada por
// contas a pagar, compras e laboratórios, mas nada na API permitia listar
// ou cadastrar um fornecedor — mesma lacuna que professionals/procedures.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

async function listSuppliers(client, clinicId) {
  const { rows } = await client.query(
    `SELECT id, legal_name, trade_name, cnpj_cpf, contact_phone, contact_email FROM suppliers WHERE clinic_id = $1 ORDER BY legal_name`,
    [clinicId]
  );
  return rows;
}

async function createSupplier(client, { clinicId, legalName, tradeName, cnpjCpf, contactPhone, contactEmail, userId }) {
  if (!legalName || !legalName.trim()) throw new DomainError('Razão social é obrigatória.', 'INVALID_NAME');

  const { rows } = await client.query(
    `INSERT INTO suppliers (clinic_id, legal_name, trade_name, cnpj_cpf, contact_phone, contact_email)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [clinicId, legalName.trim(), tradeName || null, cnpjCpf || null, contactPhone || null, contactEmail || null]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'suppliers', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

module.exports = { DomainError, listSuppliers, createSupplier };
