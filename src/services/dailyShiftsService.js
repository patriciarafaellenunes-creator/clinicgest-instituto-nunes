// src/services/dailyShiftsService.js
//
// Diárias: valor fixo pago a um profissional por dia de atendimento
// (típico de convidados/plantonistas), diferente de comissão (% sobre o
// que o paciente pagou — ver commissionService). Pagar um lote de diárias
// gera uma conta a pagar real, mesma filosofia de labOrderService: uma
// diária só entra numa conta a pagar, nunca duas (bloqueio por
// accounts_payable_id IS NULL na hora de selecionar o lote).

const { logAudit } = require('./auditService');
const financialService = require('./financialService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_STATUSES = ['pendente', 'aprovado', 'pago', 'cancelado'];

async function createDailyShift(client, {
  clinicId, unitId, professionalId, specialty, shiftDate, serviceType, amount, userId,
}) {
  if (!professionalId) throw new DomainError('Profissional é obrigatório.', 'MISSING_PROFESSIONAL');
  if (!shiftDate) throw new DomainError('Data da diária é obrigatória.', 'MISSING_SHIFT_DATE');
  if (!serviceType || !serviceType.trim()) throw new DomainError('Tipo de atendimento é obrigatório.', 'MISSING_SERVICE_TYPE');
  if (!(amount > 0)) throw new DomainError('Valor deve ser maior que zero.', 'INVALID_AMOUNT');

  const { rows } = await client.query(
    `INSERT INTO professional_daily_shifts
      (clinic_id, unit_id, professional_id, specialty, shift_date, service_type, amount, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pendente',$8)
     RETURNING *`,
    [clinicId, unitId || null, professionalId, specialty || null, shiftDate, serviceType.trim(), amount, userId]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'professional_daily_shifts', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

async function approveDailyShift(client, { id, clinicId, userId }) {
  const { rows } = await client.query(`SELECT * FROM professional_daily_shifts WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = rows[0];
  if (!before) throw new DomainError('Diária não encontrada.', 'NOT_FOUND');
  if (before.status !== 'pendente') throw new DomainError(`Não é possível aprovar uma diária com status "${before.status}".`, 'INVALID_STATUS');

  const { rows: updated } = await client.query(`UPDATE professional_daily_shifts SET status = 'aprovado' WHERE id = $1 RETURNING *`, [id]);
  await logAudit(client, { clinicId, userId, tableName: 'professional_daily_shifts', recordId: id, action: 'approve', beforeValue: before, afterValue: updated[0] });
  return updated[0];
}

/**
 * Agrupa todas as diárias aprovadas de um profissional num período em UMA
 * conta a pagar (soma dos valores) e marca cada diária como paga, vinculada
 * a essa conta. Diárias que já têm accounts_payable_id (já pagas antes)
 * nunca são selecionadas de novo — pagar duas vezes é estruturalmente
 * impossível, não só uma checagem de status.
 */
async function payDailyShifts(client, {
  clinicId, professionalId, periodStart, periodEnd, dueDate, categoryId, costCenterId, bankAccountId, userId,
}) {
  if (!dueDate) throw new DomainError('Data de vencimento da conta a pagar é obrigatória.', 'MISSING_DUE_DATE');

  const { rows: eligible } = await client.query(
    `SELECT * FROM professional_daily_shifts
     WHERE clinic_id = $1 AND professional_id = $2 AND status = 'aprovado'
       AND accounts_payable_id IS NULL AND shift_date BETWEEN $3 AND $4
     FOR UPDATE`,
    [clinicId, professionalId, periodStart, periodEnd]
  );
  if (eligible.length === 0) throw new DomainError('Nenhuma diária aprovada e ainda não paga encontrada nesse período.', 'NOTHING_ELIGIBLE');

  const { rows: profRows } = await client.query(`SELECT full_name FROM professionals WHERE id = $1`, [professionalId]);
  const professionalName = profRows[0] ? profRows[0].full_name : 'Profissional';
  const totalAmount = eligible.reduce((sum, s) => sum + Number(s.amount), 0);

  const accountPayable = await financialService.createAccountPayable(client, {
    clinicId, unitId: null, supplierId: null, bankAccountId: bankAccountId || null,
    categoryId: categoryId || null, costCenterId: costCenterId || null,
    description: `Diárias — ${professionalName} — ${periodStart} a ${periodEnd} (${eligible.length} diária(s))`,
    competenceDate: new Date().toISOString().slice(0, 10), dueDate, amount: totalAmount, isRecurring: false,
    costNature: 'variavel', userId,
  });

  // Atualiza uma linha por vez (em vez de WHERE id = ANY($uuid[])) — o
  // pg-mem usado nos testes não aplica corretamente UPDATE com array de
  // uuid (a query roda sem erro, mas atualiza zero linhas), o que já
  // causou uma diária "paga" continuar elegível para um segundo pagamento.
  // Um Postgres real aceitaria ANY(), mas este jeito funciona igual nos dois.
  const ids = eligible.map((s) => s.id);
  const updated = [];
  for (const shiftId of ids) {
    const { rows } = await client.query(
      `UPDATE professional_daily_shifts SET status = 'pago', accounts_payable_id = $1 WHERE id = $2 RETURNING *`,
      [accountPayable.id, shiftId]
    );
    updated.push(rows[0]);
  }

  await logAudit(client, {
    clinicId, userId, tableName: 'professional_daily_shifts', recordId: accountPayable.id,
    action: 'pay_batch', beforeValue: { shiftIds: ids }, afterValue: { accountPayableId: accountPayable.id, totalAmount },
  });

  return { accountPayable, shifts: updated };
}

async function listDailyShifts(client, clinicId, { professionalId, from, to, status } = {}) {
  const conditions = ['clinic_id = $1'];
  const params = [clinicId];
  if (professionalId) { params.push(professionalId); conditions.push(`professional_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`shift_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`shift_date <= $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }

  const { rows } = await client.query(
    `SELECT * FROM professional_daily_shifts WHERE ${conditions.join(' AND ')} ORDER BY shift_date DESC`,
    params
  );
  return rows;
}

module.exports = {
  DomainError, VALID_STATUSES,
  createDailyShift, approveDailyShift, payDailyShifts, listDailyShifts,
};
