// test/clinical-exams.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const clinicalExamsService = require('../src/services/clinicalExamsService');
const treatmentPlanService = require('../src/services/treatmentPlanService');

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
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price) VALUES ($1,$2,'Tratamento endodôntico', 800)`, [procedureId, clinicId]);

  console.log('\n== Teste: validação de tipo de exame ==');

  let invalidTypeBlocked = false;
  try {
    await clinicalExamsService.registerExam(client, {
      clinicId, patientId, professionalId, examType: 'raio_x_caseiro', examDate: '2026-01-10', userId,
    });
  } catch (err) {
    invalidTypeBlocked = err.code === 'INVALID_EXAM_TYPE';
  }
  assert(invalidTypeBlocked, 'tipo de exame fora da lista permitida é rejeitado');

  console.log('\n== Teste: registro de exame vinculado a item do plano de tratamento ==');

  const plan = await treatmentPlanService.createTreatmentPlan(client, {
    clinicId, patientId, professionalId, userId,
    items: [{ procedureId, toothOrRegion: '36', chargedValue: 800 }],
  });
  const planWithItems = await treatmentPlanService.getTreatmentPlanWithItems(client, clinicId, plan.id);
  const planItemId = planWithItems.items[0].id;

  const exam = await clinicalExamsService.registerExam(client, {
    clinicId, patientId, professionalId, examType: 'radiografia', toothOrRegion: '36',
    treatmentPlanItemId: planItemId, findings: 'Lesão periapical extensa',
    diagnosticHypothesis: 'Necrose pulpar', examDate: '2026-01-10', userId,
  });
  assert(exam.version === 1 && exam.treatment_plan_item_id === planItemId, 'exame registrado vinculado ao item correto do plano de tratamento');

  console.log('\n== Teste: correção não sobrescreve o exame original ==');

  const corrected = await clinicalExamsService.correctExam(client, {
    examId: exam.id, clinicId, userId, definitiveDiagnosis: 'Necrose pulpar confirmada por teste de vitalidade',
  });
  assert(corrected.id !== exam.id && corrected.supersedes_id === exam.id, 'correção gera um exame novo encadeado ao original');
  assert(corrected.findings === 'Lesão periapical extensa', 'campos não alterados na correção são preservados do original');

  const originalIntact = (await client.query(`SELECT * FROM clinical_exams WHERE id = $1`, [exam.id])).rows[0];
  assert(originalIntact.definitive_diagnosis === null && originalIntact.is_current === false, 'exame original permanece intacto (sem diagnóstico definitivo) e marcado como não-atual');

  let blockedDoubleCorrection = false;
  try {
    await clinicalExamsService.correctExam(client, { examId: exam.id, clinicId, userId, findings: 'tentando corrigir versão antiga' });
  } catch (err) {
    blockedDoubleCorrection = err.code === 'NOT_CURRENT_VERSION';
  }
  assert(blockedDoubleCorrection, 'não é possível corrigir uma versão já substituída');

  const currentExams = await clinicalExamsService.getPatientExams(client, clinicId, patientId);
  assert(currentExams.length === 1 && currentExams[0].id === corrected.id, 'listagem mostra só a versão vigente do exame');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
