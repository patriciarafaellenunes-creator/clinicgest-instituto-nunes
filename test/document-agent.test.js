// test/document-agent.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const documentAgentService = require('../src/services/documentAgentService');
const documentsService = require('../src/services/documentsService');
const termsLibraryService = require('../src/services/termsLibraryService');
const patientFilesService = require('../src/services/patientFilesService');
const professionalContractService = require('../src/services/professionalContractService');
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
  const supplierId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Teste')`, [patientId, clinicId]);
  await client.query(`INSERT INTO professionals (id, clinic_id, full_name, professional_role) VALUES ($1,$2,'Dra. Ana','dentista')`, [professionalId, clinicId]);
  await client.query(`INSERT INTO procedures (id, clinic_id, name, default_price, specialty) VALUES ($1,$2,'Tratamento de canal', 800, 'endodontia')`, [endoProcedureId, clinicId]);
  await client.query(`INSERT INTO suppliers (id, clinic_id, legal_name) VALUES ($1,$2,'Fornecedor Sem Contrato')`, [supplierId, clinicId]);

  await termsLibraryService.seedStandardTerms(client, { clinicId, userId });

  console.log('\n== Teste: grounding das ferramentas (dados reais) ==');

  const overview = await documentAgentService.executeTool(client, clinicId, 'get_required_templates_overview', {});
  assert(overview.length === termsLibraryService.STANDARD_TERMS_CATALOG.length, 'get_required_templates_overview retorna o catálogo real semeado');

  const suppliersWithout = await documentAgentService.executeTool(client, clinicId, 'get_suppliers_without_active_contract', {});
  assert(suppliersWithout.some((s) => s.id === supplierId), 'get_suppliers_without_active_contract encontra o fornecedor sem contrato assinado');

  const unauthorizedBefore = await documentAgentService.executeTool(client, clinicId, 'get_unauthorized_images', {});
  assert(unauthorizedBefore.length === 0, 'sem fotos cadastradas, não há imagens não autorizadas');

  await patientFilesService.registerFile(client, {
    clinicId, patientId, professionalId, category: 'fotografia_clinica', fileReference: '/storage/foto.jpg', userId,
  });
  const unauthorizedAfter = await documentAgentService.executeTool(client, clinicId, 'get_unauthorized_images', {});
  assert(unauthorizedAfter.length === 1 && unauthorizedAfter[0].patient_name === 'Paciente Teste', 'get_unauthorized_images encontra a foto pendente com o nome do paciente');

  const { appointment } = await agendaService.createAppointment(client, {
    clinicId, unitId, patientId, professionalId, procedureId: endoProcedureId,
    startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3600000).toISOString(),
    userId,
  });
  const missingDocs = await documentAgentService.executeTool(client, clinicId, 'get_appointments_missing_documents', { days: 7 });
  assert(missingDocs.some((a) => a.appointment_id === appointment.id), 'get_appointments_missing_documents encontra o agendamento sem termo assinado ainda');

  const authCheck = await documentAgentService.executeTool(client, clinicId, 'get_professional_authorization', { professionalId, specialty: 'endodontia' });
  assert(authCheck.hasContract === false, 'get_professional_authorization reflete corretamente que o profissional não tem contrato cadastrado ainda');

  let unknownToolBlocked = false;
  try {
    await documentAgentService.executeTool(client, clinicId, 'delete_all_contracts', {});
  } catch (err) {
    unknownToolBlocked = /desconhecida/.test(err.message);
  }
  assert(unknownToolBlocked, 'ferramenta fora da lista permitida é rejeitada — o agente não pode inventar uma ação de escrita');

  console.log('\n== Teste: loop de orquestração tool-use (com mock da API da Anthropic) ==');

  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async (_url, options) => {
    callCount++;
    const body = JSON.parse(options.body);

    if (callCount === 1) {
      assert(body.tools.some((t) => t.name === 'get_suppliers_without_active_contract'), 'lista de tools enviada à API inclui get_suppliers_without_active_contract');
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_suppliers_without_active_contract', input: {} }] }),
      };
    }

    const lastMessage = body.messages[body.messages.length - 1];
    const parsedResult = JSON.parse(lastMessage.content[0].content);
    assert(parsedResult.some((s) => s.legal_name === 'Fornecedor Sem Contrato'), 'resultado real da ferramenta chega intacto até a segunda rodada');

    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'O fornecedor "Fornecedor Sem Contrato" não tem contrato assinado.' }] }) };
  };

  try {
    const result = await documentAgentService.askDocumentAgent(client, {
      clinicId, question: 'Quais fornecedores estão sem contrato vigente?', apiKey: 'fake-key-for-test',
    });
    assert(callCount === 2, `loop fez exatamente 2 chamadas à API — veio ${callCount}`);
    assert(result.answer.includes('Fornecedor Sem Contrato'), 'resposta final cita o fornecedor real retornado pela ferramenta');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
