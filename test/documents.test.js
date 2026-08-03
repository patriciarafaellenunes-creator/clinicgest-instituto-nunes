// test/documents.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
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
  const userId = randomUUID();
  const patientId = randomUUID();
  const professionalId = randomUUID();
  const procedureId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Implante', 3500)`, [procedureId, clinicId]);

  console.log('\n== Teste: modelo de documento + checagem de obrigatoriedade ==');

  const template = await documentsService.createTemplate(client, {
    clinicId, name: 'Consentimento para Implante', category: 'termo_paciente',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o procedimento de implante...', requiredForProcedureId: procedureId, userId,
  });

  const checkBefore = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, procedureId);
  assert(checkBefore.complete === false && checkBefore.missing.length === 1, 'checagem detecta que falta o termo obrigatório antes de qualquer documento existir');

  console.log('\n== Teste: criação de documento com múltiplos signatários ==');

  const document = await documentsService.createDocument(client, {
    clinicId, templateId: template.id, category: 'termo_paciente', partyType: 'patient', patientId,
    relatedProcedureId: procedureId, content: 'Eu, Paciente Teste, autorizo o procedimento de implante...',
    signers: [
      { signerName: 'Paciente Teste', signerRole: 'paciente' },
      { signerName: 'Dra. Ana', signerRole: 'profissional' },
    ],
    userId,
  });
  assert(document.status === 'rascunho', 'documento criado como rascunho');

  const withSigs = await documentsService.getDocumentWithSignatures(client, clinicId, document.id);
  assert(withSigs.signatures.length === 2 && withSigs.signatures.every((s) => s.status === 'pendente'), 'os 2 signatários foram registrados como pendentes');

  console.log('\n== Teste: assinatura parcial vs. completa ==');

  const patientSig = withSigs.signatures.find((s) => s.signer_role === 'paciente');
  const professionalSig = withSigs.signatures.find((s) => s.signer_role === 'profissional');

  const afterFirstSignature = await documentsService.recordSignature(client, {
    documentId: document.id, signatureId: patientSig.id, clinicId, userId, signatureMethod: 'desenhada', deviceInfo: 'iPhone Safari',
  });
  assert(afterFirstSignature.fullySigned === false, 'com só um signatário, o documento ainda não está totalmente assinado');
  assert(afterFirstSignature.document.status === 'parcialmente_assinado', 'status muda para parcialmente_assinado após a primeira assinatura');
  assert(afterFirstSignature.signature.validation_code, 'código de validação é gerado na assinatura');

  let doubleSignBlocked = false;
  try {
    await documentsService.recordSignature(client, { documentId: document.id, signatureId: patientSig.id, clinicId, userId, signatureMethod: 'desenhada' });
  } catch (err) {
    doubleSignBlocked = err.code === 'ALREADY_SIGNED';
  }
  assert(doubleSignBlocked, 'o mesmo signatário não pode assinar duas vezes');

  const afterSecondSignature = await documentsService.recordSignature(client, {
    documentId: document.id, signatureId: professionalSig.id, clinicId, userId, signatureMethod: 'certificado_digital',
  });
  assert(afterSecondSignature.fullySigned === true, 'com os 2 signatários, o documento fica totalmente assinado');
  assert(afterSecondSignature.document.status === 'assinado', 'status automático vira "assinado" quando todos assinaram');

  console.log('\n== Teste: documento assinado fica travado para edição ==');

  let editBlocked = false;
  try {
    await documentsService.updateDocumentStatus(client, { id: document.id, clinicId, userId, status: 'em_revisao' });
  } catch (err) {
    editBlocked = err.code === 'DOCUMENT_LOCKED';
  }
  assert(editBlocked, 'documento assinado não pode voltar para em_revisao — está travado');

  let signAgainBlocked = false;
  try {
    await documentsService.recordSignature(client, { documentId: document.id, signatureId: patientSig.id, clinicId, userId, signatureMethod: 'desenhada' });
  } catch (err) {
    signAgainBlocked = err.code === 'DOCUMENT_LOCKED';
  }
  assert(signAgainBlocked, 'não é possível registrar novas assinaturas em documento já travado');

  console.log('\n== Teste: agora que está assinado, o procedimento libera ==');

  const checkAfter = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, procedureId);
  assert(checkAfter.complete === true, 'com o termo assinado, a checagem de documento obrigatório passa a aprovar o procedimento');

  console.log('\n== Teste: revisão cria nova versão sem apagar a original ==');

  const revised = await documentsService.reviseDocument(client, {
    originalDocumentId: document.id, clinicId, userId, content: 'Versão revisada do termo de consentimento para implante...',
  });
  assert(revised.id !== document.id && revised.supersedes_id === document.id, 'revisão gera um documento novo encadeado ao original');
  assert(revised.status === 'rascunho', 'documento revisado começa como rascunho, precisa ser assinado de novo');

  const originalAfterRevision = await documentsService.getDocumentWithSignatures(client, clinicId, document.id);
  assert(originalAfterRevision.status === 'substituido' && originalAfterRevision.is_current === false, 'original marcado como substituído, mas continua no banco intacto');
  assert(originalAfterRevision.content.includes('autorizo o procedimento de implante'), 'conteúdo do documento original não foi alterado pela revisão');

  const allDocuments = await documentsService.listDocuments(client, clinicId);
  const revisedInList = allDocuments.find((d) => d.id === revised.id);
  assert(revisedInList && revisedInList.party_name, 'listagem traz o documento corrente, com o nome da parte envolvida');
  assert(revisedInList.pending_signatures === 2, `listagem conta as assinaturas ainda pendentes do documento (veio ${revisedInList.pending_signatures})`);
  assert(!allDocuments.some((d) => d.id === document.id), 'documento substituído (não-corrente) não aparece na listagem');

  console.log('\n== Teste: assinaturas pendentes e documentos a vencer (consultas de automação) ==');

  const pending = await documentsService.getPendingSignatures(client, clinicId, { patientId });
  assert(pending.length === 2, `assinaturas pendentes do novo documento revisado aparecem na consulta (veio ${pending.length})`);

  await client.query(`UPDATE documents SET valid_until = CURRENT_DATE + 5 WHERE id = $1`, [document.id]);
  await client.query(`UPDATE documents SET is_current = true, status = 'vigente' WHERE id = $1`, [document.id]); // simula um documento vigente antigo, só para o teste de vencimento
  const expiring = await documentsService.getExpiringDocuments(client, clinicId, 30);
  assert(expiring.some((d) => d.id === document.id), 'documento com vencimento próximo aparece na consulta de expiração');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
