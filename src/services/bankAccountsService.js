// src/services/bankAccountsService.js
//
// Cadastro básico de contas bancárias/caixa. Mesma lacuna dos outros
// cadastros de apoio: pagar ou receber uma conta grava um lançamento em
// cash_ledger, que exige um bank_account_id (NOT NULL) — sem nenhum jeito
// de listar ou criar uma conta bancária pela API, nenhuma baixa era possível.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

async function listBankAccounts(client, clinicId) {
  const { rows } = await client.query(
    `SELECT id, name, bank_name, current_balance FROM bank_accounts WHERE clinic_id = $1 ORDER BY name`,
    [clinicId]
  );
  return rows;
}

async function createBankAccount(client, { clinicId, name, bankName, initialBalance, userId }) {
  if (!name || !name.trim()) throw new DomainError('Nome da conta é obrigatório.', 'INVALID_NAME');

  const { rows } = await client.query(
    `INSERT INTO bank_accounts (clinic_id, name, bank_name, current_balance) VALUES ($1,$2,$3,$4) RETURNING *`,
    [clinicId, name.trim(), bankName || null, initialBalance || 0]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'bank_accounts', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

module.exports = { DomainError, listBankAccounts, createBankAccount };
