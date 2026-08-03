// test/clinical-records.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const clinicalRecordsService = require('../src/services/clinicalRecordsService');
const agendaService = require('../src/services/agendaService');

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

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);

  console.log('\n== Teste: Anamnese versionada ==');

  const v1 = await clinicalRecordsService.createAnamnesisVersion(client, {
    clinicId, patientId, userId, chiefComplaint: 'Dor no dente 26',
    medicalHistory: { alergias: 'nenhuma', medicamentos: [] },
    riskClassification: 'baixo', signedByPatient: true,
  });
  assert(v1.version === 1 && v1.previous_version_id === null, 'primeira versão da anamnese criada corretamente');

  const v2 = await clinicalRecordsService.createAnamnesisVersion(client, {
    clinicId, patientId, userId, chiefComplaint: 'Retorno pós-tratamento',
    medicalHistory: { alergias: 'penicilina', medicamentos: ['varfarina'] },
    riskClassification: 'alto', clinicalAlerts: ['Uso de anticoagulante — risco de sangramento'], signedByPatient: true,
  });
  assert(v2.version === 2 && v2.previous_version_id === v1.id, 'segunda versão referencia a primeira');

  const current = await clinicalRecordsService.getCurrentAnamnesis(client, clinicId, patientId);
  assert(current.id === v2.id, 'apenas a versão mais recente é retornada como atual');

  const history = await clinicalRecordsService.getAnamnesisHistory(client, clinicId, patientId);
  assert(history.length === 2, `histórico preserva as duas versões (veio ${history.length})`);

  const oldVersionStillIntact = (await client.query(`SELECT * FROM clinical_anamnesis WHERE id = $1`, [v1.id])).rows[0];
  assert(oldVersionStillIntact.chief_complaint === 'Dor no dente 26', 'versão antiga da anamnese permanece intacta, não foi sobrescrita');
  assert(oldVersionStillIntact.is_current === false, 'versão antiga é marcada como não-atual, mas não é apagada');

  console.log('\n== Teste: Evolução clínica imutável, com correção em cadeia ==');

  const evolution = await clinicalRecordsService.addClinicalEvolution(client, {
    clinicId, patientId, professionalId, toothOrRegion: '26', description: 'Restauração em resina composta.',
    anestheticUsed: 'Lidocaína 2%', userId,
  });
  assert(evolution.version === 1 && evolution.supersedes_id === null, 'evolução original criada como versão 1');

  const corrected = await clinicalRecordsService.correctClinicalEvolution(client, {
    evolutionId: evolution.id, clinicId, userId, description: 'Restauração em resina composta — correção: face oclusal e proximal.',
  });
  assert(corrected.version === 2 && corrected.supersedes_id === evolution.id, 'correção cria uma nova versão apontando para a original');
  assert(corrected.id !== evolution.id, 'correção é um registro novo, não o mesmo id da original');

  const originalStillIntact = (await client.query(`SELECT * FROM clinical_evolutions WHERE id = $1`, [evolution.id])).rows[0];
  assert(originalStillIntact.description === 'Restauração em resina composta.', 'texto original da evolução permanece intacto após a correção');
  assert(originalStillIntact.is_current === false, 'original marcada como não-atual, mas não apagada');

  let blockedDoubleCorrection = false;
  try {
    await clinicalRecordsService.correctClinicalEvolution(client, { evolutionId: evolution.id, clinicId, userId, description: 'Tentando corrigir a versão antiga direto' });
  } catch (err) {
    blockedDoubleCorrection = err.code === 'NOT_CURRENT_VERSION';
  }
  assert(blockedDoubleCorrection, 'não é possível corrigir uma versão que já foi substituída (precisa corrigir a atual)');

  const chain = await clinicalRecordsService.getEvolutionVersionChain(client, clinicId, corrected.id);
  assert(chain.length === 2 && chain[0].id === evolution.id && chain[1].id === corrected.id, 'cadeia de versões reconstruída na ordem correta (original -> correção)');

  const currentEvolutions = await clinicalRecordsService.getPatientCurrentEvolutions(client, clinicId, patientId);
  assert(currentEvolutions.length === 1 && currentEvolutions[0].id === corrected.id, 'listagem de evoluções atuais mostra só a versão vigente, não a substituída');

  console.log('\n== Teste: Alerta clínico integrado à Agenda ==');

  const { alerts } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId, professionalId,
    startsAt: '2026-08-01T10:00:00Z', endsAt: '2026-08-01T11:00:00Z', userId,
  });
  assert(alerts.some((a) => a.type === 'alerta_clinico' && a.message.includes('anticoagulante')), 'alerta de anamnese (uso de anticoagulante) aparece ao agendar');
  assert(alerts.some((a) => a.type === 'classificacao_risco'), 'classificação de risco alta também gera alerta');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
