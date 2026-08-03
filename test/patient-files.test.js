// test/patient-files.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const patientFilesService = require('../src/services/patientFilesService');

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

  console.log('\n== Teste: validações de registro ==');

  let invalidCategoryBlocked = false;
  try {
    await patientFilesService.registerFile(client, {
      clinicId, patientId, professionalId, category: 'meme_engracado', fileReference: '/storage/x.jpg', userId,
    });
  } catch (err) {
    invalidCategoryBlocked = err.code === 'INVALID_CATEGORY';
  }
  assert(invalidCategoryBlocked, 'categoria fora da lista permitida é rejeitada');

  console.log('\n== Teste: registro de fotos sem autorização de uso ==');

  const photo1 = await patientFilesService.registerFile(client, {
    clinicId, patientId, professionalId, category: 'fotografia_clinica',
    fileReference: '/storage/patients/foto1.jpg', description: 'Antes do tratamento', userId,
  });
  assert(photo1.image_usage_authorized === false, 'foto registrada sem autorização de uso por padrão');

  const labReport = await patientFilesService.registerFile(client, {
    clinicId, patientId, professionalId, category: 'laudo', fileReference: '/storage/patients/laudo1.pdf', userId,
  });

  const unauthorized = await patientFilesService.getUnauthorizedImages(client, clinicId, patientId);
  assert(unauthorized.length === 1 && unauthorized[0].id === photo1.id, 'checagem de autorização encontra a foto pendente e ignora o laudo (que não é imagem)');

  await patientFilesService.setImageUsageAuthorization(client, { id: photo1.id, clinicId, userId, authorized: true });
  const unauthorizedAfter = await patientFilesService.getUnauthorizedImages(client, clinicId, patientId);
  assert(unauthorizedAfter.length === 0, 'após autorizar, a foto não aparece mais como pendente');

  console.log('\n== Teste: exclusão é sempre lógica, nunca física ==');

  let deleteWithoutReasonBlocked = false;
  try {
    await patientFilesService.logicallyDeleteFile(client, { id: labReport.id, clinicId, userId });
  } catch (err) {
    deleteWithoutReasonBlocked = err.code === 'REASON_REQUIRED';
  }
  assert(deleteWithoutReasonBlocked, 'exclusão sem motivo é bloqueada');

  const deleted = await patientFilesService.logicallyDeleteFile(client, {
    id: labReport.id, clinicId, userId, reason: 'Arquivo duplicado, laudo correto está em outro registro',
  });
  assert(deleted.is_deleted === true && deleted.deleted_reason, 'exclusão lógica registrada com motivo');

  const { rows: stillInDb } = await client.query(`SELECT * FROM patient_files WHERE id = $1`, [labReport.id]);
  assert(stillInDb.length === 1, 'registro nunca é apagado fisicamente do banco, mesmo após "excluído"');

  const activeFiles = await patientFilesService.getPatientFiles(client, clinicId, patientId);
  assert(activeFiles.length === 1 && activeFiles[0].id === photo1.id, 'listagem padrão esconde o arquivo excluído, mas não o remove');

  const allFiles = await patientFilesService.getPatientFiles(client, clinicId, patientId, { includeDeleted: true });
  assert(allFiles.length === 2, 'listagem com includeDeleted mostra os 2 arquivos, incluindo o excluído logicamente');

  let doubleDeleteBlocked = false;
  try {
    await patientFilesService.logicallyDeleteFile(client, { id: labReport.id, clinicId, userId, reason: 'tentando de novo' });
  } catch (err) {
    doubleDeleteBlocked = err.code === 'ALREADY_DELETED';
  }
  assert(doubleDeleteBlocked, 'não é possível excluir logicamente um arquivo já excluído');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
