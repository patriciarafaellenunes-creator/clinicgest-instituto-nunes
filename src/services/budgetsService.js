// src/services/budgetsService.js
//
// Fluxo (seção 7 do briefing): orçamento -> aprovação -> contrato -> parcelas
// -> contas a receber. É aqui que Financeiro, Pacientes, Agenda e CRM se
// encontram: aprovar um orçamento gera, na mesma transação, o contrato, as
// parcelas e os lançamentos em accounts_receivable (o financialService não
// precisa saber nada sobre orçamentos — ele só recebe contas a receber já
// prontas).
//
// Regra de desconto (seção 7): desconto acima do limite exige autorização
// explícita, e o sistema registra quem autorizou.

const { logAudit } = require('./auditService');
const leadsService = require('./leadsService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const DISCOUNT_APPROVAL_THRESHOLD = 0.10; // 10% do valor total exige autorização

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function createBudget(client, {
  clinicId, unitId, patientId, professionalId, items, validUntil, userId, discountApprovedBy,
}) {
  if (!items || items.length === 0) throw new DomainError('Orçamento precisa de ao menos um item.', 'EMPTY_BUDGET');

  let totalAmount = 0;
  let discountTotal = 0;
  const computedItems = items.map((item) => {
    const gross = item.quantity * item.unitPrice;
    const discount = item.discount || 0;
    const total = round2(gross - discount);
    if (total < 0) throw new DomainError('Desconto não pode ser maior que o valor do item.', 'INVALID_DISCOUNT');
    totalAmount = round2(totalAmount + total);
    discountTotal = round2(discountTotal + discount);
    return { ...item, total };
  });

  const discountPercentage = totalAmount + discountTotal > 0 ? discountTotal / (totalAmount + discountTotal) : 0;
  if (discountPercentage > DISCOUNT_APPROVAL_THRESHOLD && !discountApprovedBy) {
    throw new DomainError(
      `Desconto de ${(discountPercentage * 100).toFixed(1)}% excede o limite de ${DISCOUNT_APPROVAL_THRESHOLD * 100}% e precisa de autorização.`,
      'DISCOUNT_APPROVAL_REQUIRED'
    );
  }

  const { rows } = await client.query(
    `INSERT INTO budgets (clinic_id, unit_id, patient_id, professional_id, status, total_amount, discount_amount, discount_approved_by, valid_until, created_by)
     VALUES ($1,$2,$3,$4,'rascunho',$5,$6,$7,$8,$9)
     RETURNING *`,
    [clinicId, unitId, patientId, professionalId || null, totalAmount, discountTotal, discountApprovedBy || null, validUntil || null, userId]
  );
  const budget = rows[0];

  for (const item of computedItems) {
    await client.query(
      `INSERT INTO budget_items (budget_id, procedure_id, quantity, unit_price, discount, total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [budget.id, item.procedureId, item.quantity, item.unitPrice, item.discount || 0, item.total]
    );
  }

  await logAudit(client, { clinicId, userId, tableName: 'budgets', recordId: budget.id, action: 'insert', afterValue: budget });
  return budget;
}

async function updateBudgetStatus(client, { id, clinicId, userId, status }) {
  const allowed = ['apresentado', 'em_negociacao', 'recusado', 'expirado', 'cancelado'];
  if (!allowed.includes(status)) throw new DomainError(`Transição de status inválida: ${status}`, 'INVALID_STATUS');

  const { rows: beforeRows } = await client.query(`SELECT * FROM budgets WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Orçamento não encontrado.', 'NOT_FOUND');
  if (['aprovado', 'cancelado'].includes(before.status)) {
    throw new DomainError(`Orçamento em status final ("${before.status}") não pode ser alterado.`, 'INVALID_TRANSITION');
  }

  const { rows } = await client.query(`UPDATE budgets SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
  await logAudit(client, { clinicId, userId, tableName: 'budgets', recordId: id, action: 'update_status', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

/**
 * Aprova o orçamento e gera, na mesma transação: contrato, parcelas e
 * contas a receber correspondentes. Se `leadId` for informado, fecha o lead.
 */
async function approveBudget(client, {
  id, clinicId, userId, unitId, installmentCount = 1, firstDueDate, paymentMethodId, bankAccountId, leadId,
}) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM budgets WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Orçamento não encontrado.', 'NOT_FOUND');
  if (!['apresentado', 'em_negociacao'].includes(before.status)) {
    throw new DomainError(`Orçamento no status "${before.status}" não pode ser aprovado.`, 'INVALID_TRANSITION');
  }
  if (installmentCount < 1) throw new DomainError('Número de parcelas deve ser ao menos 1.', 'INVALID_INSTALLMENT_COUNT');
  if (!firstDueDate) throw new DomainError('Data de vencimento da primeira parcela é obrigatória.', 'MISSING_DUE_DATE');

  const { rows: contractRows } = await client.query(
    `INSERT INTO contracts (budget_id, patient_id, total_amount, status) VALUES ($1,$2,$3,'ativo') RETURNING *`,
    [id, before.patient_id, before.total_amount]
  );
  const contract = contractRows[0];

  const totalCents = Math.round(before.total_amount * 100);
  const baseCents = Math.floor(totalCents / installmentCount);
  const remainderCents = totalCents - baseCents * installmentCount;

  const installments = [];
  for (let n = 1; n <= installmentCount; n++) {
    const cents = baseCents + (n === installmentCount ? remainderCents : 0);
    const amount = round2(cents / 100);
    const dueDate = new Date(firstDueDate);
    dueDate.setMonth(dueDate.getMonth() + (n - 1));

    const { rows: instRows } = await client.query(
      `INSERT INTO installments (contract_id, installment_number, due_date, amount, payment_method_id, status)
       VALUES ($1,$2,$3,$4,$5,'previsto') RETURNING *`,
      [contract.id, n, dueDate.toISOString().slice(0, 10), amount, paymentMethodId || null]
    );
    const installment = instRows[0];

    await client.query(
      `INSERT INTO accounts_receivable (clinic_id, unit_id, patient_id, installment_id, bank_account_id, competence_date, due_date, amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente')`,
      [clinicId, unitId, before.patient_id, installment.id, bankAccountId || null,
       new Date().toISOString().slice(0, 10), installment.due_date, amount]
    );

    installments.push(installment);
  }

  const { rows: updatedBudget } = await client.query(`UPDATE budgets SET status = 'aprovado' WHERE id = $1 RETURNING *`, [id]);

  await logAudit(client, { clinicId, userId, tableName: 'budgets', recordId: id, action: 'approve', beforeValue: before, afterValue: updatedBudget[0] });
  await logAudit(client, { clinicId, userId, tableName: 'contracts', recordId: contract.id, action: 'insert', afterValue: contract });

  if (leadId) {
    await leadsService.updateLeadStatus(client, { id: leadId, clinicId, userId, status: 'fechado' });
    await leadsService.linkLeadToPatient(client, { leadId, patientId: before.patient_id, clinicId, userId });
  }

  return { budget: updatedBudget[0], contract, installments };
}

/** Lista os orçamentos da clínica (com nome do paciente) — usado pela tela de Orçamentos. */
async function listBudgets(client, clinicId, { status } = {}) {
  const conditions = ['b.clinic_id = $1'];
  const params = [clinicId];
  if (status) { params.push(status); conditions.push(`b.status = $${params.length}`); }

  const { rows } = await client.query(
    `SELECT b.*, p.full_name AS patient_name
     FROM budgets b JOIN patients p ON p.id = b.patient_id
     WHERE ${conditions.join(' AND ')} ORDER BY b.created_at DESC`,
    params
  );
  return rows;
}

async function getBudgetWithItems(client, clinicId, budgetId) {
  const { rows: budgetRows } = await client.query(`SELECT * FROM budgets WHERE id = $1 AND clinic_id = $2`, [budgetId, clinicId]);
  const budget = budgetRows[0];
  if (!budget) throw new DomainError('Orçamento não encontrado.', 'NOT_FOUND');

  const { rows: items } = await client.query(
    `SELECT bi.*, p.name AS procedure_name FROM budget_items bi
     JOIN procedures p ON p.id = bi.procedure_id WHERE bi.budget_id = $1`,
    [budgetId]
  );
  return { ...budget, items };
}

module.exports = {
  DomainError, DISCOUNT_APPROVAL_THRESHOLD,
  createBudget, updateBudgetStatus, approveBudget, listBudgets, getBudgetWithItems,
};
