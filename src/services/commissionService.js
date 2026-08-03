// src/services/commissionService.js
//
// Cálculo de comissão (seção 16 do briefing original). No MVP, suporta o
// modo "comissão sobre recebimento" — o mais auditável, porque é calculado
// sobre dinheiro que realmente entrou no caixa (accounts_receivable.received
// _amount), não sobre uma promessa de venda.
//
// A garantia contra pagamento duplicado (exigência explícita do briefing)
// não depende só da query de elegibilidade filtrar o que já foi pago — a
// constraint UNIQUE em commission_payout_items.accounts_receivable_id
// impede, no nível do banco, que a mesma conta a receber entre em duas
// apurações. Mesmo que a lógica da aplicação tivesse um bug, o banco
// rejeitaria a segunda tentativa.

const { logAudit } = require('./auditService');
const professionalContractService = require('./professionalContractService');
const financialService = require('./financialService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Calcula e registra a comissão de um profissional sobre os recebimentos do período, ignorando o que já entrou em outra apuração. */
async function calculateCommissionForProfessional(client, { clinicId, professionalId, periodStart, periodEnd, userId }) {
  const terms = await professionalContractService.getActiveContractTerms(client, clinicId, professionalId);
  if (!terms) throw new DomainError('Profissional não tem contrato assinado com termos de comissão definidos.', 'NO_ACTIVE_CONTRACT');
  if (terms.remuneration_type !== 'comissao_recebimento') {
    throw new DomainError(
      `Cálculo automático só é suportado para o modo "comissao_recebimento" no momento (contrato usa "${terms.remuneration_type}").`,
      'UNSUPPORTED_REMUNERATION_TYPE'
    );
  }
  if (!terms.commission_percentage || Number(terms.commission_percentage) <= 0) {
    throw new DomainError('Contrato não define um percentual de comissão válido.', 'MISSING_COMMISSION_PERCENTAGE');
  }

  const { rows: eligible } = await client.query(
    `SELECT ar.* FROM accounts_receivable ar
     JOIN installments i ON i.id = ar.installment_id
     JOIN contracts c ON c.id = i.contract_id
     JOIN budgets b ON b.id = c.budget_id
     LEFT JOIN commission_payout_items cpi ON cpi.accounts_receivable_id = ar.id
     WHERE b.professional_id = $1 AND ar.clinic_id = $2 AND ar.received_amount > 0
       AND cpi.id IS NULL
       AND ar.competence_date BETWEEN $3 AND $4
     ORDER BY ar.competence_date`,
    [professionalId, clinicId, periodStart, periodEnd]
  );

  if (eligible.length === 0) {
    throw new DomainError('Nenhum recebimento elegível encontrado para este profissional no período (ou tudo já foi apurado antes).', 'NO_ELIGIBLE_RECEIVABLES');
  }

  const percentage = Number(terms.commission_percentage);
  let totalBase = 0;
  let totalCommission = 0;
  const itemsToInsert = eligible.map((ar) => {
    const base = Number(ar.received_amount);
    const commission = round2(base * (percentage / 100));
    totalBase = round2(totalBase + base);
    totalCommission = round2(totalCommission + commission);
    return { accountsReceivableId: ar.id, base, commission };
  });

  const { rows: payoutRows } = await client.query(
    `INSERT INTO commission_payouts
      (clinic_id, professional_id, period_start, period_end, commission_percentage, total_base_amount, total_commission_amount, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'calculado',$8)
     RETURNING *`,
    [clinicId, professionalId, periodStart, periodEnd, percentage, totalBase, totalCommission, userId]
  );
  const payout = payoutRows[0];

  try {
    for (const item of itemsToInsert) {
      await client.query(
        `INSERT INTO commission_payout_items (commission_payout_id, accounts_receivable_id, base_amount, commission_amount)
         VALUES ($1,$2,$3,$4)`,
        [payout.id, item.accountsReceivableId, item.base, item.commission]
      );
    }
  } catch (err) {
    // A constraint UNIQUE em accounts_receivable_id é a última linha de defesa contra duplicidade.
    if (/unique/i.test(err.message)) {
      throw new DomainError('Uma das contas a receber já havia sido incluída em outra apuração de comissão (bloqueado pelo banco).', 'DUPLICATE_RECEIVABLE');
    }
    throw err;
  }

  await logAudit(client, { clinicId, userId, tableName: 'commission_payouts', recordId: payout.id, action: 'insert', afterValue: payout });

  return getCommissionPayoutWithItems(client, clinicId, payout.id);
}

/** Lista as apurações de comissão da clínica (com nome do profissional) — usado pela tela de Comissões. */
async function listCommissionPayouts(client, clinicId) {
  const { rows } = await client.query(
    `SELECT cp.*, pr.full_name AS professional_name
     FROM commission_payouts cp JOIN professionals pr ON pr.id = cp.professional_id
     WHERE cp.clinic_id = $1 ORDER BY cp.created_at DESC`,
    [clinicId]
  );
  return rows;
}

async function getCommissionPayoutWithItems(client, clinicId, payoutId) {
  const { rows: payoutRows } = await client.query(`SELECT * FROM commission_payouts WHERE id = $1 AND clinic_id = $2`, [payoutId, clinicId]);
  const payout = payoutRows[0];
  if (!payout) throw new DomainError('Apuração de comissão não encontrada.', 'NOT_FOUND');

  const { rows: items } = await client.query(`SELECT * FROM commission_payout_items WHERE commission_payout_id = $1`, [payoutId]);
  return { ...payout, items };
}

async function approveCommissionPayout(client, { id, clinicId, userId }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM commission_payouts WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Apuração de comissão não encontrada.', 'NOT_FOUND');
  if (before.status !== 'calculado') throw new DomainError(`Apuração no status "${before.status}" não pode ser aprovada.`, 'INVALID_TRANSITION');

  const { rows } = await client.query(`UPDATE commission_payouts SET status = 'aprovado' WHERE id = $1 RETURNING *`, [id]);
  await logAudit(client, { clinicId, userId, tableName: 'commission_payouts', recordId: id, action: 'approve', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

/** Marca a apuração como paga e gera a conta a pagar correspondente ao profissional. */
async function markCommissionPayoutAsPaid(client, { id, clinicId, userId, dueDate, categoryId, costCenterId, bankAccountId }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM commission_payouts WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Apuração de comissão não encontrada.', 'NOT_FOUND');
  if (before.status !== 'aprovado') throw new DomainError(`Apuração no status "${before.status}" precisa estar aprovada antes de gerar o pagamento.`, 'INVALID_TRANSITION');
  if (!dueDate) throw new DomainError('Data de vencimento é obrigatória.', 'MISSING_DUE_DATE');

  const { rows: professionalRows } = await client.query(`SELECT full_name FROM professionals WHERE id = $1`, [before.professional_id]);
  const professionalName = professionalRows[0] ? professionalRows[0].full_name : 'Profissional';

  const formatDate = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const accountPayable = await financialService.createAccountPayable(client, {
    clinicId, unitId: null, supplierId: null, bankAccountId: bankAccountId || null, categoryId: categoryId || null, costCenterId: costCenterId || null,
    description: `Comissão — ${professionalName} — período ${formatDate(before.period_start)} a ${formatDate(before.period_end)}`,
    competenceDate: new Date().toISOString().slice(0, 10), dueDate, amount: before.total_commission_amount, isRecurring: false, userId,
  });

  const { rows } = await client.query(
    `UPDATE commission_payouts SET status = 'pago', accounts_payable_id = $1 WHERE id = $2 RETURNING *`,
    [accountPayable.id, id]
  );

  await logAudit(client, { clinicId, userId, tableName: 'commission_payouts', recordId: id, action: 'mark_paid', beforeValue: before, afterValue: rows[0] });
  return { payout: rows[0], accountPayable };
}

module.exports = {
  DomainError,
  calculateCommissionForProfessional, getCommissionPayoutWithItems, listCommissionPayouts,
  approveCommissionPayout, markCommissionPayoutAsPaid,
};
