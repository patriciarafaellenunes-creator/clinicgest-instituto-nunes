// test/periodontal.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const periodontalService = require('../src/services/periodontalService');

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

  console.log('\n== Teste: validações de entrada ==');

  let invalidSiteBlocked = false;
  try {
    await periodontalService.createPeriodontalExam(client, {
      clinicId, patientId, professionalId, examDate: '2026-01-10',
      measurements: [{ toothNumber: '26', site: 'lado_de_dentro', probingDepth: 3 }], userId,
    });
  } catch (err) {
    invalidSiteBlocked = err.code === 'INVALID_SITE';
  }
  assert(invalidSiteBlocked, 'sítio de medição inválido é rejeitado');

  console.log('\n== Teste: primeiro exame (linha de base) ==');

  const exam1 = await periodontalService.createPeriodontalExam(client, {
    clinicId, patientId, professionalId, examDate: '2026-01-10',
    measurements: [
      { toothNumber: '26', site: 'mesio_vestibular', probingDepth: 3, bleeding: false, recession: 0 },
      { toothNumber: '26', site: 'vestibular', probingDepth: 3, bleeding: false, recession: 0 },
      { toothNumber: '36', site: 'mesio_vestibular', probingDepth: 2, bleeding: false, recession: 0 },
    ],
    userId,
  });
  assert(exam1.version === 1, 'primeiro exame criado como versão 1');

  const detail1 = await periodontalService.getExamWithMeasurements(client, clinicId, exam1.id);
  assert(detail1.measurements.length === 3, 'todas as medições do exame foram salvas');
  assert(detail1.summary.bleedingIndex === 0, 'índice de sangramento calculado corretamente (0% na linha de base)');
  assert(detail1.measurements[0].clinical_attachment_level === 3, 'nível clínico de inserção calculado (profundidade + recessão)');

  console.log('\n== Teste: segundo exame mostrando progressão da doença ==');

  const exam2 = await periodontalService.createPeriodontalExam(client, {
    clinicId, patientId, professionalId, examDate: '2026-07-10',
    measurements: [
      { toothNumber: '26', site: 'mesio_vestibular', probingDepth: 6, bleeding: true, recession: 1 }, // piorou bastante
      { toothNumber: '26', site: 'vestibular', probingDepth: 3, bleeding: false, recession: 0 }, // estável
      { toothNumber: '36', site: 'mesio_vestibular', probingDepth: 2, bleeding: false, recession: 0 }, // estável
    ],
    userId,
  });

  const comparison = await periodontalService.compareExams(client, clinicId, exam1.id, exam2.id);
  assert(comparison.siteChanges.length === 1, `apenas o sítio que realmente mudou aparece na comparação (veio ${comparison.siteChanges.length})`);
  const change = comparison.siteChanges[0];
  assert(change.toothNumber === '26' && change.site === 'mesio_vestibular', 'comparação identifica o sítio correto');
  assert(change.trend === 'progressao' && change.delta === 3, `progressão detectada corretamente (3mm -> 6mm, delta ${change.delta})`);
  assert(change.bleedingBefore === false && change.bleedingAfter === true, 'mudança de sangramento também é registrada na comparação');

  console.log('\n== Teste: correção não sobrescreve o exame original ==');

  const corrected = await periodontalService.correctPeriodontalExam(client, {
    examId: exam1.id, clinicId, userId, examDate: '2026-01-10',
    measurements: [
      { toothNumber: '26', site: 'mesio_vestibular', probingDepth: 4, bleeding: false, recession: 0 }, // corrigindo um valor digitado errado
      { toothNumber: '26', site: 'vestibular', probingDepth: 3, bleeding: false, recession: 0 },
      { toothNumber: '36', site: 'mesio_vestibular', probingDepth: 2, bleeding: false, recession: 0 },
    ],
  });
  assert(corrected.id !== exam1.id, 'correção gera um exame novo, com id diferente');
  assert(corrected.supersedes_id === exam1.id, 'exame corrigido referencia o original');

  const originalStillIntact = await periodontalService.getExamWithMeasurements(client, clinicId, exam1.id);
  assert(originalStillIntact.measurements.find((m) => m.site === 'mesio_vestibular').probing_depth === 3, 'medição original (3mm) permanece intacta mesmo após a correção');
  assert(originalStillIntact.is_current === false, 'exame original marcado como não-atual após a correção');

  let blockedDoubleCorrection = false;
  try {
    await periodontalService.correctPeriodontalExam(client, {
      examId: exam1.id, clinicId, userId, measurements: [{ toothNumber: '26', site: 'vestibular', probingDepth: 1 }],
    });
  } catch (err) {
    blockedDoubleCorrection = err.code === 'NOT_CURRENT_VERSION';
  }
  assert(blockedDoubleCorrection, 'não é possível corrigir um exame que já foi substituído');

  console.log('\n== Teste: histórico do paciente mostra só exames vigentes ==');

  const history = await periodontalService.getPatientExamHistory(client, clinicId, patientId);
  assert(history.length === 2, `histórico mostra os 2 exames vigentes (linha de base corrigida + segundo exame), não o original substituído (veio ${history.length})`);
  assert(!history.some((e) => e.id === exam1.id), 'exame substituído não aparece no histórico de exames vigentes');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
