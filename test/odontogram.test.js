// test/odontogram.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const odontogramService = require('../src/services/odontogramService');

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

  console.log('\n== Teste: condição inválida é rejeitada ==');

  let invalidBlocked = false;
  try {
    await odontogramService.setToothCondition(client, {
      clinicId, patientId, toothNumber: '26', toothCondition: 'quebrado_por_acidente', userId,
    });
  } catch (err) {
    invalidBlocked = err.code === 'INVALID_CONDITION';
  }
  assert(invalidBlocked, 'condição fora da lista permitida é rejeitada');

  console.log('\n== Teste: versionamento por slot (dente + face) ==');

  const t1 = new Date('2026-01-10T10:00:00Z').toISOString();
  await client.query(`UPDATE odontogram_entries SET created_at = $1 WHERE false`, []); // no-op, mantém padrão de escrita explícita abaixo

  const entryOclusal = await odontogramService.setToothCondition(client, {
    clinicId, patientId, toothNumber: '26', face: 'oclusal', toothCondition: 'carie',
    professionalId, notes: 'Cárie identificada na consulta inicial', userId,
  });
  assert(entryOclusal.version === 1 && entryOclusal.supersedes_id === null, 'primeira condição do slot (26, oclusal) criada como versão 1');

  // Slot diferente (mesmo dente, sem face) não deve conflitar com o slot da face oclusal
  const entryWholeTooth = await odontogramService.setToothCondition(client, {
    clinicId, patientId, toothNumber: '18', toothCondition: 'ausente', professionalId, userId,
  });
  assert(entryWholeTooth.face === null, 'condição de dente inteiro (sem face) tratada como slot separado');

  const treated = await odontogramService.setToothCondition(client, {
    clinicId, patientId, toothNumber: '26', face: 'oclusal', toothCondition: 'restauracao',
    professionalId, notes: 'Restauração realizada', userId,
  });
  assert(treated.version === 2 && treated.supersedes_id === entryOclusal.id, 'atualização do mesmo slot encadeia com a versão anterior');

  const oldEntryIntact = (await client.query(`SELECT * FROM odontogram_entries WHERE id = $1`, [entryOclusal.id])).rows[0];
  assert(oldEntryIntact.tooth_condition === 'carie' && oldEntryIntact.is_current === false, 'condição anterior (cárie) permanece intacta no histórico, só marcada como não-atual');

  console.log('\n== Teste: odontograma atual ==');

  const current = await odontogramService.getCurrentOdontogram(client, clinicId, patientId);
  assert(current.length === 2, `odontograma atual mostra 2 slots vigentes: dente 26/oclusal e dente 18 (veio ${current.length})`);
  const tooth26 = current.find((e) => e.tooth_number === '26');
  assert(tooth26.tooth_condition === 'restauracao', 'odontograma atual do dente 26 reflete a condição mais recente (restauração), não a cárie antiga');
  assert(tooth26.legend && tooth26.legend.color === '#2563EB', 'legenda/cor da condição vem junto na resposta');

  console.log('\n== Teste: reconstrução por data e comparação entre snapshots ==');

  const chain = await odontogramService.getToothVersionChain(client, clinicId, treated.id);
  assert(chain.length === 2 && chain[0].tooth_condition === 'carie' && chain[1].tooth_condition === 'restauracao', 'cadeia de versões do dente 26 reconstruída em ordem cronológica (cárie -> restauração)');

  const now = new Date();
  const farFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const farPast = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const snapshotNow = await odontogramService.getOdontogramAsOf(client, clinicId, patientId, farFuture);
  assert(snapshotNow.length === 2, 'snapshot no futuro próximo reflete o estado atual completo');

  const snapshotPast = await odontogramService.getOdontogramAsOf(client, clinicId, patientId, farPast);
  assert(snapshotPast.length === 0, 'snapshot antes de qualquer registro existir vem vazio');

  const changes = await odontogramService.compareOdontogramSnapshots(client, clinicId, patientId, farPast, farFuture);
  assert(changes.length === 2, `comparação detecta os 2 dentes como novos entre o passado vazio e o presente (veio ${changes.length})`);
  const tooth26Change = changes.find((c) => c.toothNumber === '26');
  assert(tooth26Change.change === 'novo' && tooth26Change.after === 'restauracao', 'comparação mostra a condição final (restauração), não um estado intermediário');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
