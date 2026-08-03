// test/terms-library.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
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
  const userId = randomUUID();
  const patientId = randomUUID();
  const professionalId = randomUUID();
  const implantProcedureId = randomUUID();
  const anotherImplantProcedureId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Implante unitário', 3500, 'implantodontia')`, [implantProcedureId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Implante múltiplo', 9000, 'implantodontia')`, [anotherImplantProcedureId, clinicId]);

  console.log('\n== Teste: semeadura do catálogo padrão ==');

  const created = await termsLibraryService.seedStandardTerms(client, { clinicId, userId });
  assert(created.length === termsLibraryService.STANDARD_TERMS_CATALOG.length, `todos os ${termsLibraryService.STANDARD_TERMS_CATALOG.length} modelos do catálogo foram criados`);

  const secondSeed = await termsLibraryService.seedStandardTerms(client, { clinicId, userId });
  assert(secondSeed.length === 0, 'semear de novo não duplica modelos já existentes (idempotente)');

  const { rows: implantTemplate } = await client.query(
    `SELECT * FROM document_templates WHERE clinic_id = $1 AND name = 'Consentimento para Implante Dentário'`, [clinicId]
  );
  assert(implantTemplate[0].required_for_specialty === 'implantodontia', 'modelo de implante foi criado com exigência por especialidade, não por procedimento específico');

  console.log('\n== Teste: exigência por especialidade cobre QUALQUER procedimento daquela especialidade ==');

  const checkImplant1 = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, implantProcedureId);
  const checkImplant2 = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, anotherImplantProcedureId);
  assert(checkImplant1.complete === false && checkImplant2.complete === false, 'ambos os procedimentos de implantodontia exigem o termo, mesmo sendo procedimentos diferentes (exigência é por especialidade)');
  assert(checkImplant1.missing[0].templateName === 'Consentimento para Implante Dentário', 'termo correto identificado como faltante');

  console.log('\n== Teste: instanciar documento de verdade a partir de um modelo da biblioteca ==');

  const document = await termsLibraryService.instantiateDocumentFromTemplate(client, {
    templateId: implantTemplate[0].id, clinicId, patientId, professionalId,
    patientName: 'Paciente Teste', professionalName: 'Dra. Ana', relatedProcedureId: implantProcedureId, userId,
  });
  assert(document.content.includes('Paciente Teste') && document.content.includes('Dra. Ana'), 'placeholders do modelo foram substituídos pelos nomes reais');
  assert(document.content.includes('Falha de osseointegração'), 'seção de riscos do conteúdo clínico estruturado foi incluída no texto final');
  assert(document.content.includes('Prótese removível'), 'seção de alternativas também foi incluída');

  const withSigs = await documentsService.getDocumentWithSignatures(client, clinicId, document.id);
  assert(withSigs.signatures.length === 2, 'assinaturas padrão (paciente + profissional) já vêm configuradas ao instanciar');

  console.log('\n== Teste: assinar UM dos DOIS termos exigidos ainda deixa pendência ==');

  for (const sig of withSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: document.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'desenhada' });
  }

  const checkStillMissingGraft = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, implantProcedureId);
  assert(checkStillMissingGraft.complete === false, 'especialidade implantodontia exige 2 termos (implante + enxerto ósseo) — assinar só um ainda deixa pendência real');
  assert(checkStillMissingGraft.missing.length === 1 && checkStillMissingGraft.missing[0].templateName.includes('Enxerto'), 'o termo que falta é identificado corretamente (enxerto ósseo)');

  const { rows: graftTemplate } = await client.query(
    `SELECT * FROM document_templates WHERE clinic_id = $1 AND name = 'Consentimento para Enxerto Ósseo'`, [clinicId]
  );
  const graftDocument = await termsLibraryService.instantiateDocumentFromTemplate(client, {
    templateId: graftTemplate[0].id, clinicId, patientId, professionalId,
    patientName: 'Paciente Teste', professionalName: 'Dra. Ana', relatedProcedureId: implantProcedureId, userId,
  });
  const graftWithSigs = await documentsService.getDocumentWithSignatures(client, clinicId, graftDocument.id);
  for (const sig of graftWithSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: graftDocument.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'desenhada' });
  }

  const checkAfterBothSigned = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, implantProcedureId);
  assert(checkAfterBothSigned.complete === true, 'com os 2 termos assinados, agora sim o procedimento de implante fica liberado');

  const checkOtherImplantProcedure = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, anotherImplantProcedureId);
  assert(checkOtherImplantProcedure.complete === true, 'os mesmos termos assinados também liberam o OUTRO procedimento de implantodontia (exigência é por especialidade, não por procedimento específico)');

  console.log('\n== Teste: especialidade com um único termo exigido resolve integralmente com uma assinatura ==');

  const endoProcedureId = randomUUID();
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Tratamento de canal', 800, 'endodontia')`, [endoProcedureId, clinicId]);

  const checkEndoBefore = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, endoProcedureId);
  assert(checkEndoBefore.complete === false && checkEndoBefore.missing.length === 1, 'endodontia tem só 1 termo no catálogo, então falta exatamente 1 antes de qualquer assinatura');

  const { rows: endoTemplate } = await client.query(
    `SELECT * FROM document_templates WHERE clinic_id = $1 AND name = 'Consentimento para Tratamento Endodôntico'`, [clinicId]
  );
  const endoDocument = await termsLibraryService.instantiateDocumentFromTemplate(client, {
    templateId: endoTemplate[0].id, clinicId, patientId, professionalId,
    patientName: 'Paciente Teste', professionalName: 'Dra. Ana', relatedProcedureId: endoProcedureId, userId,
  });
  const endoWithSigs = await documentsService.getDocumentWithSignatures(client, clinicId, endoDocument.id);
  for (const sig of endoWithSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: endoDocument.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'desenhada' });
  }

  const checkEndoAfter = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, patientId, endoProcedureId);
  assert(checkEndoAfter.complete === true, 'com o único termo exigido assinado, o procedimento de endodontia fica totalmente liberado');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
