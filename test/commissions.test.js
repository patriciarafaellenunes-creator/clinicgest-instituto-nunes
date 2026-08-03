// test/commissions.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const commissionService = require('../src/services/commissionService');
const professionalContractService = require('../src/services/professionalContractService');
const documentsService = require('../src/services/documentsService');
const budgetsService = require('../src/services/budgetsService');
const financialService = require('../src/services/financialService');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

async function main() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => require('crypto').randomUUID(),
    impure: true,
  });

  let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  schema = schema.replace(/CREATE EXTENSION.*\n/g, '');
  db.public.none(schema);

  const { Client } = db.adapters.createPg();
  const client = new Client();
  await client.connect();

  const { randomUUID } = require('crypto');
  const companyId = randomUUID();
  const clinicId = randomUUID();
  const unitId = randomUUID();
  const userId = randomUUID();
  const patientId = randomUUID();
  const professionalId = randomUUID();
  const procedureId = randomUUID();
  const bankAccountId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Restauração', 1000)`, [procedureId, clinicId]);
  await client.query(`INSERT INTO bank_accounts (id, clinic_id, name, current_balance) VALUES ($1,$2,'Conta Principal', 0)`, [bankAccountId, clinicId]);

  console.log('\n== Teste: sem contrato de comissão, o cálculo é bloqueado ==');

  let noContractBlocked = false;
  try {
    await commissionService.calculateCommissionForProfessional(client, {
      clinicId, professionalId, periodStart: '2026-01-01', periodEnd: '2026-12-31', userId,
    });
  } catch (err) {
    noContractBlocked = err.code === 'NO_ACTIVE_CONTRACT';
  }
  assert(noContractBlocked, 'sem contrato assinado com termos de comissão, o cálculo é bloqueado');

  console.log('\n== Teste: contrato de comissão sobre recebimento ==');

  const { document: contractDoc } = await professionalContractService.createProfessionalContract(client, {
    clinicId, unitId, professionalId, content: 'Contrato — comissão de 30% sobre recebimento.',
    remunerationType: 'comissao_recebimento', commissionPercentage: 30,
    signers: [{ signerName: 'Dra. Ana', signerRole: 'profissional' }, { signerName: 'Gestora', signerRole: 'gestor' }],
    userId,
  });
  const withSigs = await documentsService.getDocumentWithSignatures(client, clinicId, contractDoc.id);
  for (const sig of withSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: contractDoc.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'certificado_digital' });
  }

  console.log('\n== Teste: gerar receita real (orçamento -> contrato -> parcela -> recebimento) atribuída à profissional ==');

  const budget = await budgetsService.createBudget(client, {
    clinicId, unitId, patientId, professionalId, userId,
    items: [{ procedureId, quantity: 1, unitPrice: 1000, discount: 0 }],
  });
  await budgetsService.updateBudgetStatus(client, { id: budget.id, clinicId, userId, status: 'apresentado' });
  const { installments } = await budgetsService.approveBudget(client, {
    id: budget.id, clinicId, userId, unitId, installmentCount: 1, firstDueDate: '2026-03-01', bankAccountId,
  });

  const { rows: receivableRows } = await client.query(`SELECT * FROM accounts_receivable WHERE installment_id = $1`, [installments[0].id]);
  await financialService.receivePayment(client, {
    id: receivableRows[0].id, clinicId, userId, receivedAmount: 1000, bankAccountId,
  });

  console.log('\n== Teste: cálculo de comissão sobre o recebimento real ==');

  const payout = await commissionService.calculateCommissionForProfessional(client, {
    clinicId, professionalId, periodStart: '2026-01-01', periodEnd: '2026-12-31', userId,
  });
  assert(payout.status === 'calculado', 'apuração criada com status calculado');
  assert(Number(payout.total_base_amount) === 1000, `base da comissão é o valor recebido (R$1000, veio ${payout.total_base_amount})`);
  assert(Number(payout.total_commission_amount) === 300, `comissão de 30% calculada corretamente (R$300, veio ${payout.total_commission_amount})`);
  assert(payout.items.length === 1, 'um item de comissão vinculado à conta a receber correspondente');

  console.log('\n== Teste: calcular de novo NÃO conta o mesmo recebimento duas vezes ==');

  let noEligibleBlocked = false;
  try {
    await commissionService.calculateCommissionForProfessional(client, {
      clinicId, professionalId, periodStart: '2026-01-01', periodEnd: '2026-12-31', userId,
    });
  } catch (err) {
    noEligibleBlocked = err.code === 'NO_ELIGIBLE_RECEIVABLES';
  }
  assert(noEligibleBlocked, 'rodar o cálculo de novo no mesmo período não encontra nada elegível — o recebimento já foi apurado, não é contado de novo');

  console.log('\n== Teste: fluxo de aprovação e pagamento gera conta a pagar real ==');

  let payBeforeApprovalBlocked = false;
  try {
    await commissionService.markCommissionPayoutAsPaid(client, { id: payout.id, clinicId, userId, dueDate: '2026-04-01' });
  } catch (err) {
    payBeforeApprovalBlocked = err.code === 'INVALID_TRANSITION';
  }
  assert(payBeforeApprovalBlocked, 'não é possível pagar uma apuração ainda não aprovada');

  await commissionService.approveCommissionPayout(client, { id: payout.id, clinicId, userId });
  const { payout: paidPayout, accountPayable } = await commissionService.markCommissionPayoutAsPaid(client, {
    id: payout.id, clinicId, userId, dueDate: '2026-04-01',
  });
  assert(paidPayout.status === 'pago', 'apuração marcada como paga');
  assert(Number(accountPayable.amount) === 300, `conta a pagar gerada com o valor exato da comissão (veio ${accountPayable.amount})`);

  const allPayouts = await commissionService.listCommissionPayouts(client, clinicId);
  assert(allPayouts.length === 1 && allPayouts[0].professional_name, 'listagem de apurações traz o nome do profissional');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
