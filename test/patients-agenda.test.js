// test/patients-agenda.test.js
// Mesma abordagem do teste financeiro: schema real + pg-mem, sem precisar
// de um Postgres de verdade rodando.

const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const patientsService = require('../src/services/patientsService');
const agendaService = require('../src/services/agendaService');
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
  const roomA = randomUUID();
  const roomB = randomUUID();
  const professionalId = randomUUID();
  const userId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO rooms (id, unit_id, name) VALUES ($1,$2,'Sala 1')`, [roomA, unitId]);
  await client.query(`INSERT INTO rooms (id, unit_id, name) VALUES ($1,$2,'Sala 2')`, [roomB, unitId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(
    `INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`,
    [professionalId, clinicId]
  );

  console.log('\n== Teste: Pacientes ==');

  const patient = await patientsService.createPatient(client, {
    clinicId, unitId, fullName: 'Maria Silva', cpf: '123.456.789-00', phone: '(41) 99999-1111',
    email: 'maria@example.com', userId,
  });
  assert(patient.cpf === '12345678900', 'CPF salvo só com dígitos (normalizado)');

  let duplicateBlocked = false;
  try {
    await patientsService.createPatient(client, {
      clinicId, unitId, fullName: 'Maria da Silva (outro cadastro)', cpf: '123.456.789-00', userId,
    });
  } catch (err) {
    duplicateBlocked = err.code === 'POSSIBLE_DUPLICATE';
  }
  assert(duplicateBlocked, 'cadastro duplicado por CPF é bloqueado');

  const found = await patientsService.searchPatients(client, clinicId, { query: 'Maria' });
  assert(found.length === 1, 'busca por nome encontra a paciente');

  console.log('\n== Teste: Agenda ==');

  const startsAt = '2026-07-20T14:00:00Z';
  const endsAt = '2026-07-20T15:00:00Z';

  const { appointment: appt1, alerts: alerts1 } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId: patient.id, professionalId, roomId: roomA, startsAt, endsAt, userId,
  });
  assert(appt1.status === 'agendado', 'agendamento criado com status agendado');
  assert(alerts1.length === 0, 'paciente sem pendência não gera alerta');

  // Conflito: mesmo profissional, horário sobreposto, sala diferente -> deve bloquear
  let conflictBlocked = false;
  try {
    await agendaService.createAppointment(client, {
      clinicId, unitId, patientId: patient.id, professionalId, roomId: roomB,
      startsAt: '2026-07-20T14:30:00Z', endsAt: '2026-07-20T15:30:00Z', userId,
    });
  } catch (err) {
    conflictBlocked = err.code === 'SCHEDULE_CONFLICT';
  }
  assert(conflictBlocked, 'conflito de horário do mesmo profissional é bloqueado');

  // Sem conflito: horário diferente, mesmo profissional
  const { appointment: appt2 } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId: patient.id, professionalId, roomId: roomA,
    startsAt: '2026-07-20T16:00:00Z', endsAt: '2026-07-20T17:00:00Z', userId,
  });
  assert(appt2.id !== appt1.id, 'segundo agendamento em horário livre é criado normalmente');

  const dayAgenda = await agendaService.getAgendaByProfessional(client, clinicId, { professionalId, date: '2026-07-20' });
  assert(dayAgenda.length === 2, `agenda do dia lista os 2 atendimentos (veio ${dayAgenda.length})`);

  const updated = await agendaService.updateAppointmentStatus(client, {
    id: appt1.id, clinicId, userId, status: 'confirmado',
  });
  assert(updated.status === 'confirmado', 'status atualizado para confirmado');

  const idleSlots = await agendaService.getIdleSlots(client, clinicId, { professionalId, date: '2026-07-20' });
  const overlapsBusy = idleSlots.some((s) => s.start.toISOString() === '2026-07-20T14:00:00.000Z');
  assert(!overlapsBusy, 'horários ociosos não incluem os já ocupados');
  assert(idleSlots.length > 0, `sistema identifica horários ociosos (encontrou ${idleSlots.length})`);

  console.log('\n== Teste: Alerta de inadimplência na agenda ==');

  const bankAccountId = randomUUID();
  await client.query(`INSERT INTO bank_accounts (id, clinic_id, name, current_balance) VALUES ($1,$2,'Conta Principal',0)`, [bankAccountId, clinicId]);
  await financialService.createAccountReceivable(client, {
    clinicId, unitId, patientId: patient.id, bankAccountId,
    competenceDate: '2026-06-01', dueDate: '2026-06-10', amount: 300, userId,
  });

  const { alerts: alerts2 } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId: patient.id, professionalId, roomId: roomA,
    startsAt: '2026-07-21T10:00:00Z', endsAt: '2026-07-21T11:00:00Z', userId,
  });
  assert(alerts2.length === 1 && alerts2[0].type === 'inadimplencia', 'novo agendamento alerta sobre pendência financeira do paciente');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
