// src/services/financialService.js
//
// Regras de negócio do módulo financeiro (ver seções 9-11 do plano mestre):
//   - Nenhum registro é apagado fisicamente; cancelamento/estorno é um status.
//   - Toda baixa gera um lançamento em cash_ledger no mesmo instante (sem lote).
//   - Baixa em duplicidade é bloqueada (idempotência por status).
//   - competence_date (regime de competência) e due_date/paid_at (regime de caixa)
//     são sempre registrados separadamente, para o DRE ficar correto nos dois regimes.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// CONTAS A PAGAR
// ---------------------------------------------------------------------------

async function createAccountPayable(client, { clinicId, unitId, supplierId, bankAccountId,
  categoryId, costCenterId, description, competenceDate, dueDate, amount, isRecurring, costNature, userId }) {
  if (amount <= 0) throw new DomainError('Valor deve ser maior que zero.', 'INVALID_AMOUNT');

  const { rows } = await client.query(
    `INSERT INTO accounts_payable
      (clinic_id, unit_id, supplier_id, bank_account_id, category_id, cost_center_id,
       description, competence_date, due_date, amount, is_recurring, cost_nature, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendente')
     RETURNING *`,
    [clinicId, unitId, supplierId, bankAccountId, categoryId, costCenterId,
     description, competenceDate, dueDate, amount, !!isRecurring, costNature || null]
  );
  const record = rows[0];

  await logAudit(client, {
    clinicId, userId, tableName: 'accounts_payable', recordId: record.id,
    action: 'insert', afterValue: record,
  });

  return record;
}

async function approveAccountPayable(client, { id, clinicId, userId }) {
  const { rows } = await client.query(
    `SELECT * FROM accounts_payable WHERE id = $1 AND clinic_id = $2`, [id, clinicId]
  );
  const before = rows[0];
  if (!before) throw new DomainError('Conta a pagar não encontrada.', 'NOT_FOUND');
  if (before.status !== 'pendente') {
    throw new DomainError(`Não é possível aprovar uma conta com status "${before.status}".`, 'INVALID_STATUS');
  }

  const { rows: updated } = await client.query(
    `UPDATE accounts_payable SET status = 'aprovado', approved_by = $1
     WHERE id = $2 RETURNING *`,
    [userId, id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'accounts_payable', recordId: id,
    action: 'approve', beforeValue: before, afterValue: updated[0],
  });

  return updated[0];
}

/**
 * Baixa (paga) uma conta a pagar, total ou parcial. Gera lançamento em
 * cash_ledger e atualiza o saldo da conta bancária. Bloqueia baixa duplicada.
 */
async function payAccountPayable(client, { id, clinicId, userId, paidAmount, bankAccountId, paidDate }) {
  const { rows } = await client.query(
    `SELECT * FROM accounts_payable WHERE id = $1 AND clinic_id = $2 FOR UPDATE`, [id, clinicId]
  );
  const before = rows[0];
  if (!before) throw new DomainError('Conta a pagar não encontrada.', 'NOT_FOUND');
  if (['pago', 'cancelado'].includes(before.status)) {
    throw new DomainError(`Conta já está com status "${before.status}" — baixa em duplicidade bloqueada.`, 'DUPLICATE_PAYMENT');
  }
  if (paidAmount <= 0) throw new DomainError('Valor pago deve ser maior que zero.', 'INVALID_AMOUNT');

  const newPaidTotal = Number(before.paid_amount) + Number(paidAmount);
  if (newPaidTotal > Number(before.amount) + 0.01) {
    throw new DomainError('Valor pago excede o valor da conta.', 'OVERPAYMENT');
  }
  const newStatus = newPaidTotal >= Number(before.amount) - 0.01 ? 'pago' : 'aprovado';

  const { rows: updated } = await client.query(
    `UPDATE accounts_payable SET paid_amount = $1, status = $2, bank_account_id = COALESCE($3, bank_account_id)
     WHERE id = $4 RETURNING *`,
    [newPaidTotal, newStatus, bankAccountId, id]
  );

  await client.query(
    `INSERT INTO cash_ledger (clinic_id, bank_account_id, entry_date, entry_type, amount, source_table, source_id, description)
     VALUES ($1,$2,$3,'saida',$4,'accounts_payable',$5,$6)`,
    [clinicId, bankAccountId || before.bank_account_id, paidDate || new Date(), paidAmount, id, before.description]
  );

  await client.query(
    `UPDATE bank_accounts SET current_balance = current_balance - $1 WHERE id = $2`,
    [paidAmount, bankAccountId || before.bank_account_id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'accounts_payable', recordId: id,
    action: 'pay', beforeValue: before, afterValue: updated[0],
  });

  return updated[0];
}

/** Lista contas a pagar (opcionalmente por status) — usado pela tela de Financeiro. */
async function listAccountsPayable(client, clinicId, { status } = {}) {
  const conditions = ['ap.clinic_id = $1'];
  const params = [clinicId];
  if (status) { params.push(status); conditions.push(`ap.status = $${params.length}`); }

  const { rows } = await client.query(
    `SELECT ap.*, s.legal_name AS supplier_name
     FROM accounts_payable ap LEFT JOIN suppliers s ON s.id = ap.supplier_id
     WHERE ${conditions.join(' AND ')} ORDER BY ap.due_date ASC`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// CONTAS A RECEBER
// ---------------------------------------------------------------------------

async function createAccountReceivable(client, { clinicId, unitId, patientId, installmentId,
  bankAccountId, categoryId, costCenterId, description, competenceDate, dueDate, amount, userId }) {
  if (amount <= 0) throw new DomainError('Valor deve ser maior que zero.', 'INVALID_AMOUNT');

  const { rows } = await client.query(
    `INSERT INTO accounts_receivable
      (clinic_id, unit_id, patient_id, installment_id, bank_account_id, category_id, cost_center_id,
       description, competence_date, due_date, amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pendente')
     RETURNING *`,
    [clinicId, unitId, patientId, installmentId, bankAccountId, categoryId, costCenterId,
     description || null, competenceDate, dueDate, amount]
  );
  const record = rows[0];

  await logAudit(client, {
    clinicId, userId, tableName: 'accounts_receivable', recordId: record.id,
    action: 'insert', afterValue: record,
  });

  return record;
}

async function receivePayment(client, { id, clinicId, userId, receivedAmount, bankAccountId, receivedDate }) {
  const { rows } = await client.query(
    `SELECT * FROM accounts_receivable WHERE id = $1 AND clinic_id = $2 FOR UPDATE`, [id, clinicId]
  );
  const before = rows[0];
  if (!before) throw new DomainError('Conta a receber não encontrada.', 'NOT_FOUND');
  if (['pago', 'cancelado', 'estornado'].includes(before.status)) {
    throw new DomainError(`Conta já está com status "${before.status}" — baixa em duplicidade bloqueada.`, 'DUPLICATE_PAYMENT');
  }
  if (receivedAmount <= 0) throw new DomainError('Valor recebido deve ser maior que zero.', 'INVALID_AMOUNT');

  const newReceivedTotal = Number(before.received_amount) + Number(receivedAmount);
  const newStatus = newReceivedTotal >= Number(before.amount) - 0.01
    ? 'pago'
    : 'parcialmente_pago';

  const { rows: updated } = await client.query(
    `UPDATE accounts_receivable SET received_amount = $1, status = $2, bank_account_id = COALESCE($3, bank_account_id)
     WHERE id = $4 RETURNING *`,
    [newReceivedTotal, newStatus, bankAccountId, id]
  );

  await client.query(
    `INSERT INTO cash_ledger (clinic_id, bank_account_id, entry_date, entry_type, amount, source_table, source_id, description)
     VALUES ($1,$2,$3,'entrada',$4,'accounts_receivable',$5,'Recebimento de paciente')`,
    [clinicId, bankAccountId || before.bank_account_id, receivedDate || new Date(), receivedAmount, id]
  );

  await client.query(
    `UPDATE bank_accounts SET current_balance = current_balance + $1 WHERE id = $2`,
    [receivedAmount, bankAccountId || before.bank_account_id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'accounts_receivable', recordId: id,
    action: 'receive', beforeValue: before, afterValue: updated[0],
  });

  return updated[0];
}

/** Lista contas a receber (opcionalmente por status) — usado pela tela de Financeiro. */
async function listAccountsReceivable(client, clinicId, { status } = {}) {
  const conditions = ['ar.clinic_id = $1'];
  const params = [clinicId];
  if (status) { params.push(status); conditions.push(`ar.status = $${params.length}`); }

  const { rows } = await client.query(
    `SELECT ar.*, p.full_name AS patient_name
     FROM accounts_receivable ar LEFT JOIN patients p ON p.id = ar.patient_id
     WHERE ${conditions.join(' AND ')} ORDER BY ar.due_date ASC`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// PROJEÇÃO DE CAIXA E DASHBOARD (o que o agente de IA consulta)
// ---------------------------------------------------------------------------

async function getCurrentCashBalance(client, clinicId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(current_balance), 0) AS total FROM bank_accounts WHERE clinic_id = $1`,
    [clinicId]
  );
  return Number(rows[0].total);
}

/**
 * Projeta o saldo de caixa em N dias somando recebimentos e pagamentos
 * previstos ainda não baixados dentro da janela.
 */
async function getCashProjection(client, clinicId, horizonDays) {
  const currentBalance = await getCurrentCashBalance(client, clinicId);

  const { rows: recv } = await client.query(
    `SELECT COALESCE(SUM(amount - received_amount), 0) AS total
     FROM accounts_receivable
     WHERE clinic_id = $1 AND status NOT IN ('pago','cancelado','estornado')
       AND due_date <= CURRENT_DATE + $2::int`,
    [clinicId, horizonDays]
  );
  const { rows: pay } = await client.query(
    `SELECT COALESCE(SUM(amount - paid_amount), 0) AS total
     FROM accounts_payable
     WHERE clinic_id = $1 AND status NOT IN ('pago','cancelado')
       AND due_date <= CURRENT_DATE + $2::int`,
    [clinicId, horizonDays]
  );

  const expectedIn = Number(recv[0].total);
  const expectedOut = Number(pay[0].total);

  return {
    horizonDays,
    currentBalance,
    expectedIn,
    expectedOut,
    projectedBalance: currentBalance + expectedIn - expectedOut,
  };
}

async function getOverdueReceivables(client, clinicId) {
  const { rows } = await client.query(
    `SELECT ar.id, ar.patient_id, p.full_name AS patient_name, ar.amount, ar.received_amount,
            ar.due_date, (CURRENT_DATE - ar.due_date) AS days_overdue
     FROM accounts_receivable ar
     JOIN patients p ON p.id = ar.patient_id
     WHERE ar.clinic_id = $1 AND ar.status NOT IN ('pago','cancelado','estornado')
       AND ar.due_date < CURRENT_DATE
     ORDER BY days_overdue DESC`,
    [clinicId]
  );
  return rows;
}

async function getDashboardSummary(client, clinicId, { periodStart, periodEnd }) {
  const [
    currentBalance,
    { rows: revenue },
    { rows: pending },
    { rows: payable },
    projection30,
  ] = await Promise.all([
    getCurrentCashBalance(client, clinicId),
    client.query(
      `SELECT COALESCE(SUM(amount),0) AS gross, COALESCE(SUM(received_amount),0) AS received
       FROM accounts_receivable
       WHERE clinic_id = $1 AND competence_date BETWEEN $2 AND $3`,
      [clinicId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT COALESCE(SUM(amount - received_amount),0) AS total
       FROM accounts_receivable WHERE clinic_id = $1 AND status NOT IN ('pago','cancelado','estornado')`,
      [clinicId]
    ),
    client.query(
      `SELECT COALESCE(SUM(amount - paid_amount),0) AS total
       FROM accounts_payable WHERE clinic_id = $1 AND status = 'vencido'`,
      [clinicId]
    ),
    getCashProjection(client, clinicId, 30),
  ]);

  return {
    currentBalance,
    revenueGross: Number(revenue[0].gross),
    revenueReceived: Number(revenue[0].received),
    receivablePending: Number(pending[0].total),
    payableOverdue: Number(payable[0].total),
    cashProjection30d: projection30.projectedBalance,
  };
}

module.exports = {
  DomainError,
  createAccountPayable,
  approveAccountPayable,
  payAccountPayable,
  listAccountsPayable,
  createAccountReceivable,
  receivePayment,
  listAccountsReceivable,
  getCurrentCashBalance,
  getCashProjection,
  getOverdueReceivables,
  getDashboardSummary,
};
