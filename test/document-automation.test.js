// test/document-automation.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const documentAutomationService = require('../src/services/documentAutomationService');
const treatmentPlanService = require('../src/services/treatmentPlanService');
const termsLibraryService = require('../src/services/termsLibraryService');
const documentsService = require('../src/services/documentsService');

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
  const endoProcedureId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Tratamento de canal', 800, 'endodontia')`, [endoProcedureId, clinicId]);

  await termsLibraryService.seedStandardTerms(client, { clinicId, userId });

  console.log('\n== Teste: aprovar plano gera automaticamente o termo obrigatório (como rascunho) ==');

  const plan = await treatmentPlanService.createTreatmentPlan(client, {
    clinicId, patientId, professionalId, userId,
    items: [{ procedureId: endoProcedureId, toothOrRegion: '36', chargedValue: 800 }],
  });
  const planWithItems = await treatmentPlanService.getTreatmentPlanWithItems(client, clinicId, plan.id);
  await treatmentPlanService.updatePlanStatus(client, { id: plan.id, clinicId, userId, status: 'apresentado' });
  await treatmentPlanService.recordItemDecision(client, { itemId: planWithItems.items[0].id, clinicId, userId, decision: 'aceito' });

  const { plan: approvedPlan, generatedDocuments } = await documentAutomationService.approveTreatmentPlanWithAutomation(client, {
    planId: plan.id, clinicId, unitId, userId,
  });
  assert(approvedPlan.status === 'aprovado', 'plano aprovado normalmente pela automação');
  assert(generatedDocuments.length === 1, `exatamente 1 termo gerado automaticamente (o de endodontia, único exigido) — veio ${generatedDocuments.length}`);
  assert(generatedDocuments[0].content.includes('Paciente Teste'), 'documento gerado já vem com o nome do paciente preenchido');
  assert(generatedDocuments[0].status === 'rascunho', 'documento gerado fica como RASCUNHO — a automação nunca assina sozinha');

  console.log('\n== Teste: reaprovar o plano não duplica o documento já gerado (idempotência) ==');

  const secondRun = await documentAutomationService.generateRequiredDocumentsForPlan(client, { planId: plan.id, clinicId, unitId, userId });
  assert(secondRun.length === 0, 'rodar a geração de novo não cria um segundo rascunho do mesmo termo');

  const { rows: allDocsForPatient } = await client.query(`SELECT * FROM documents WHERE patient_id = $1`, [patientId]);
  assert(allDocsForPatient.length === 1, 'continua existindo só 1 documento no banco pra esse paciente, mesmo após rodar a automação duas vezes');

  console.log('\n== Teste: assinar o documento gerado resolve a pendência do procedimento ==');

  const checkBefore = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, endoProcedureId);
  assert(checkBefore.complete === false, 'ainda pendente, porque o documento gerado automaticamente não está assinado');

  const withSigs = await documentsService.getDocumentWithSignatures(client, clinicId, generatedDocuments[0].id);
  for (const sig of withSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: generatedDocuments[0].id, signatureId: sig.id, clinicId, userId, signatureMethod: 'desenhada' });
  }
  const checkAfter = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, endoProcedureId);
  assert(checkAfter.complete === true, 'depois de assinado (por uma pessoa, não pela automação), o procedimento fica liberado');

  console.log('\n== Teste: notificação de contratos vencendo, com idempotência ==');

  const supplierId = randomUUID();
  await client.query(`INSERT INTO suppliers (id, clinic_id, legal_name) VALUES ($1,$2,'Fornecedor Teste')`, [supplierId, clinicId]);
  const { rows: contractRows } = await client.query(
    `INSERT INTO documents (clinic_id, category, party_type, supplier_id, content, status, valid_until)
     VALUES ($1,'contrato_fornecedor','supplier',$2,'Contrato de fornecimento','vigente', CURRENT_DATE + 10) RETURNING *`,
    [clinicId, supplierId]
  );
  assert(contractRows.length === 1, 'contrato de teste inserido diretamente para simular um contrato já vigente e próximo do vencimento');

  const firstNotifyRun = await documentAutomationService.notifyExpiringContracts(client, { clinicId, days: 30, userId });
  assert(firstNotifyRun.length === 1, 'primeira execução cria a notificação de vencimento');

  const secondNotifyRun = await documentAutomationService.notifyExpiringContracts(client, { clinicId, days: 30, userId });
  assert(secondNotifyRun.length === 0, 'segunda execução não duplica a notificação enquanto a primeira não foi lida');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
