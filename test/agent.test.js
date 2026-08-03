// test/agent.test.js
//
// Duas coisas são testadas, separadamente:
// 1. Que cada tool do agente retorna dados corretos e reais (grounding) —
//    contra o schema real via pg-mem, igual aos outros testes.
// 2. Que o loop de orquestração (askFinancialAgent) processa corretamente
//    uma rodada de tool_use -> tool_result -> resposta final. Isso é testado
//    com um mock do fetch da API da Anthropic, já que este sandbox não tem
//    ANTHROPIC_API_KEY configurada — o mock simula exatamente o formato de
//    resposta real da API (tool_use blocks, depois texto final), então
//    valida o código de orquestração de verdade, só sem gastar uma chamada
//    de API real.

const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const aiAgentService = require('../src/services/aiAgentService');
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
  const userId = randomUUID();
  const patientId = randomUUID();
  const bankAccountId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO units (id, clinic_id, name) VALUES ($1,$2,'Unidade Centro')`, [unitId, clinicId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  await client.query(`INSERT INTO patients (id, clinic_id, full_name) VALUES ($1,$2,'Paciente Inadimplente')`, [patientId, clinicId]);
  await client.query(`INSERT INTO bank_accounts (id, clinic_id, name, current_balance) VALUES ($1,$2,'Conta Principal', 5000)`, [bankAccountId, clinicId]);

  // Conta vencida, para o agente conseguir responder "quem está inadimplente"
  await financialService.createAccountReceivable(client, {
    clinicId, unitId, patientId, bankAccountId,
    competenceDate: '2026-06-01', dueDate: '2026-06-15', amount: 450, userId,
  });

  console.log('\n== Teste: grounding das ferramentas (dados reais, não inventados) ==');

  const overdue = await aiAgentService.executeTool(client, clinicId, 'get_overdue_receivables', {});
  assert(overdue.length === 1 && Number(overdue[0].amount) === 450, `get_overdue_receivables retorna a conta vencida real (veio ${JSON.stringify(overdue)})`);

  const dashboard = await aiAgentService.executeTool(client, clinicId, 'get_dashboard_summary', { periodStart: '2026-01-01', periodEnd: '2026-12-31' });
  assert(dashboard.currentBalance === 5000, `get_dashboard_summary reflete o saldo real da conta bancária (veio ${dashboard.currentBalance})`);

  const projection = await aiAgentService.executeTool(client, clinicId, 'get_cash_projection', { horizonDays: 30 });
  assert(projection.currentBalance === 5000, 'get_cash_projection parte do saldo real');

  const funnel = await aiAgentService.executeTool(client, clinicId, 'get_funnel_summary', {});
  assert(funnel.conversionRate === null, 'get_funnel_summary lida corretamente com clínica sem leads ainda (não inventa uma taxa)');

  let unknownToolBlocked = false;
  try {
    await aiAgentService.executeTool(client, clinicId, 'delete_everything', {});
  } catch (err) {
    unknownToolBlocked = /desconhecida/.test(err.message);
  }
  assert(unknownToolBlocked, 'ferramenta fora da lista permitida é rejeitada (agente não pode inventar uma ação)');

  console.log('\n== Teste: loop de orquestração tool-use (com mock da API da Anthropic) ==');

  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async (_url, options) => {
    callCount++;
    const body = JSON.parse(options.body);

    if (callCount === 1) {
      // Simula o modelo pedindo a ferramenta get_overdue_receivables
      assert(body.tools.some((t) => t.name === 'get_overdue_receivables'), 'a lista de tools enviada à API inclui get_overdue_receivables');
      return {
        ok: true,
        json: async () => ({
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'get_overdue_receivables', input: {} },
          ],
        }),
      };
    }

    // Segunda rodada: o modelo já recebeu o tool_result e responde em texto
    const lastMessage = body.messages[body.messages.length - 1];
    const toolResultContent = lastMessage.content[0].content;
    const parsedResult = JSON.parse(toolResultContent);
    assert(parsedResult.length === 1 && Number(parsedResult[0].amount) === 450, 'o resultado real da ferramenta chega até a segunda rodada intacto');

    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Há 1 paciente inadimplente, com R$ 450,00 em atraso.' }],
      }),
    };
  };

  try {
    const result = await aiAgentService.askFinancialAgent(client, {
      clinicId, question: 'Quais pacientes estão inadimplentes?', apiKey: 'fake-key-for-test',
    });
    assert(callCount === 2, `loop fez exatamente 2 chamadas à API (uma tool_use, uma final) — veio ${callCount}`);
    assert(result.answer.includes('450'), 'resposta final contém o valor real vindo da ferramenta');
    assert(result.toolCallLog.length === 1 && result.toolCallLog[0].tool === 'get_overdue_receivables', 'log de ferramentas usadas registra a chamada real');
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
