// test/clinical-documents.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const clinicalDocumentsService = require('../src/services/clinicalDocumentsService');

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

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);

  console.log('\n== Teste: validação de conteúdo por tipo de documento ==');

  let invalidTypeBlocked = false;
  try {
    await clinicalDocumentsService.issueDocument(client, {
      clinicId, patientId, professionalId, documentType: 'bilhete_qualquer', content: {}, userId,
    });
  } catch (err) {
    invalidTypeBlocked = err.code === 'INVALID_DOCUMENT_TYPE';
  }
  assert(invalidTypeBlocked, 'tipo de documento fora da lista é rejeitado');

  let missingDaysBlocked = false;
  try {
    await clinicalDocumentsService.issueDocument(client, {
      clinicId, patientId, professionalId, documentType: 'atestado', content: {}, userId,
    });
  } catch (err) {
    missingDaysBlocked = err.code === 'MISSING_DAYS_OFF';
  }
  assert(missingDaysBlocked, 'atestado sem dias de afastamento é rejeitado');

  let missingMedsBlocked = false;
  try {
    await clinicalDocumentsService.issueDocument(client, {
      clinicId, patientId, professionalId, documentType: 'receita_simples', content: { medications: [] }, userId,
    });
  } catch (err) {
    missingMedsBlocked = err.code === 'MISSING_MEDICATIONS';
  }
  assert(missingMedsBlocked, 'receita sem medicamentos é rejeitada');

  console.log('\n== Teste: emissão válida de atestado e receita ==');

  const atestado = await clinicalDocumentsService.issueDocument(client, {
    clinicId, patientId, professionalId, documentType: 'atestado',
    content: { daysOff: 2, reason: 'Procedimento cirúrgico', cid: null }, userId,
  });
  assert(atestado.status === 'emitido', 'atestado emitido com sucesso');

  const receita = await clinicalDocumentsService.issueDocument(client, {
    clinicId, patientId, professionalId, documentType: 'receita_controle_especial',
    content: { medications: [{ name: 'Amoxicilina', dosage: '500mg', instructions: '1 comprimido a cada 8h por 7 dias' }] },
    userId,
  });
  assert(receita.document_type === 'receita_controle_especial', 'receita de controle especial emitida corretamente');

  console.log('\n== Teste: documento emitido não pode ser editado, só cancelado ==');

  let cancelWithoutReasonBlocked = false;
  try {
    await clinicalDocumentsService.cancelDocument(client, { id: atestado.id, clinicId, userId });
  } catch (err) {
    cancelWithoutReasonBlocked = err.code === 'REASON_REQUIRED';
  }
  assert(cancelWithoutReasonBlocked, 'cancelamento sem motivo é bloqueado');

  const cancelled = await clinicalDocumentsService.cancelDocument(client, {
    id: atestado.id, clinicId, userId, reason: 'Emitido com número de dias errado, será reemitido',
  });
  assert(cancelled.status === 'cancelado' && cancelled.cancelled_reason, 'cancelamento registrado com motivo');

  const originalContentIntact = await clinicalDocumentsService.getDocument(client, clinicId, atestado.id);
  assert(originalContentIntact.content.daysOff === 2, 'conteúdo original do documento permanece intacto mesmo após cancelado (não foi editado)');

  let doubleCancelBlocked = false;
  try {
    await clinicalDocumentsService.cancelDocument(client, { id: atestado.id, clinicId, userId, reason: 'Tentando cancelar de novo' });
  } catch (err) {
    doubleCancelBlocked = err.code === 'ALREADY_CANCELLED';
  }
  assert(doubleCancelBlocked, 'não é possível cancelar um documento já cancelado');

  console.log('\n== Teste: listagem de documentos do paciente ==');

  const allDocs = await clinicalDocumentsService.getPatientDocuments(client, clinicId, patientId);
  assert(allDocs.length === 2, `listagem mostra os 2 documentos emitidos, incluindo o cancelado (veio ${allDocs.length})`);

  const onlyReceitas = await clinicalDocumentsService.getPatientDocuments(client, clinicId, patientId, { documentType: 'receita_controle_especial' });
  assert(onlyReceitas.length === 1 && onlyReceitas[0].id === receita.id, 'filtro por tipo de documento funciona corretamente');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
