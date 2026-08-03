// test/professional-contracts.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const professionalContractService = require('../src/services/professionalContractService');
const documentsService = require('../src/services/documentsService');
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
  const endoProcedureId = randomUUID();
  const implantProcedureId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dr. Endo','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Tratamento de canal', 800, 'endodontia')`, [endoProcedureId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Implante unitário', 3500, 'implantodontia')`, [implantProcedureId, clinicId]);

  console.log('\n== Teste: sem contrato registrado, não há bloqueio (comportamento padrão do MVP) ==');

  const authWithoutContract = await professionalContractService.isProfessionalAuthorized(client, clinicId, professionalId, { procedureId: implantProcedureId });
  assert(authWithoutContract.hasContract === false && authWithoutContract.authorized === true, 'profissional sem contrato cadastrado não é bloqueado (evita travar clínicas que ainda não migraram contratos)');

  const { appointment: apptWithoutContract } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId, professionalId, procedureId: implantProcedureId,
    startsAt: '2026-08-01T09:00:00Z', endsAt: '2026-08-01T10:00:00Z', userId,
  });
  assert(apptWithoutContract.status === 'agendado', 'agendamento livre funciona normalmente sem contrato de referência');

  console.log('\n== Teste: criação do contrato de profissional com autorização restrita ==');

  let invalidRemunerationBlocked = false;
  try {
    await professionalContractService.createProfessionalContract(client, {
      clinicId, unitId, professionalId, content: 'Contrato de prestação de serviços...',
      remunerationType: 'salario_fixo_mensal_generoso', userId,
    });
  } catch (err) {
    invalidRemunerationBlocked = err.code === 'INVALID_REMUNERATION_TYPE';
  }
  assert(invalidRemunerationBlocked, 'tipo de remuneração fora da lista permitida é rejeitado');

  const { document, terms } = await professionalContractService.createProfessionalContract(client, {
    clinicId, unitId, professionalId, content: 'Contrato de prestação de serviços — Dr. Endo, especialista em endodontia.',
    authorizedSpecialties: ['endodontia'], remunerationType: 'comissao_procedimento', commissionPercentage: 40,
    signers: [{ signerName: 'Dr. Endo', signerRole: 'profissional' }, { signerName: 'Gestora', signerRole: 'gestor' }],
    userId,
  });
  assert(terms.commission_percentage == 40 && terms.remuneration_type === 'comissao_procedimento', 'termos de remuneração salvos corretamente');
  assert(document.status === 'rascunho', 'contrato criado como rascunho, ainda sem valer para autorização (precisa ser assinado)');

  console.log('\n== Teste: contrato em rascunho ainda não bloqueia nada (só o assinado vale) ==');

  const authWhileDraft = await professionalContractService.isProfessionalAuthorized(client, clinicId, professionalId, { specialty: 'implantodontia' });
  assert(authWhileDraft.hasContract === false, 'contrato não assinado ainda não conta como referência de autorização');

  console.log('\n== Teste: após assinar, a restrição passa a valer de verdade ==');

  const withSigs = await documentsService.getDocumentWithSignatures(client, clinicId, document.id);
  for (const sig of withSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: document.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'certificado_digital' });
  }

  const authForEndo = await professionalContractService.isProfessionalAuthorized(client, clinicId, professionalId, { specialty: 'endodontia' });
  assert(authForEndo.hasContract === true && authForEndo.authorized === true, 'profissional está autorizado para a especialidade do próprio contrato');

  const authForImplant = await professionalContractService.isProfessionalAuthorized(client, clinicId, professionalId, { specialty: 'implantodontia' });
  assert(authForImplant.hasContract === true && authForImplant.authorized === false, 'profissional NÃO está autorizado para especialidade fora do contrato');

  console.log('\n== Teste: agenda BLOQUEIA de verdade o agendamento fora da autorização ==');

  let schedulingBlocked = false;
  try {
    await agendaService.createAppointment(client, {
      clinicId, unitId, patientId, professionalId, procedureId: implantProcedureId,
      startsAt: '2026-08-02T09:00:00Z', endsAt: '2026-08-02T10:00:00Z', userId,
    });
  } catch (err) {
    schedulingBlocked = err.code === 'PROFESSIONAL_NOT_AUTHORIZED';
  }
  assert(schedulingBlocked, 'agenda impede escalar o profissional para um procedimento fora do seu contrato — não é só um alerta, é um bloqueio real');

  const { appointment: authorizedAppt } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId, professionalId, procedureId: endoProcedureId,
    startsAt: '2026-08-02T11:00:00Z', endsAt: '2026-08-02T12:00:00Z', userId,
  });
  assert(authorizedAppt.status === 'agendado', 'agendamento dentro da especialidade autorizada funciona normalmente');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
