// src/services/aiAgentService.js
//
// Este é o "diretor financeiro virtual" da seção 2 do briefing. Ele NUNCA
// consulta o banco diretamente e NUNCA gera números por conta própria — só
// pode responder através de chamadas às tools abaixo, que são wrappers finos
// em cima dos services de domínio já testados (financialService,
// leadsService, inventoryService, patientsService). Isso é o que impede o
// agente de "alucinar" um valor: se a pergunta não mapeia para uma tool
// existente, ele deve dizer que não tem esse dado, não estimar.
//
// Todas as tools são somente leitura por design — o agente não tem como
// excluir, alterar ou mover dinheiro sozinho. Ações desse tipo ficam fora do
// escopo dele deliberadamente (ver seção 2: "Solicitar confirmação antes de
// excluir, alterar ou movimentar informações sensíveis" — a forma mais segura
// de garantir isso num MVP é o agente simplesmente não ter essa capacidade).

const financialService = require('./financialService');
const leadsService = require('./leadsService');
const inventoryService = require('./inventoryService');
const patientsService = require('./patientsService');

const SYSTEM_PROMPT = `Você é o diretor financeiro virtual de uma clínica odontológica, dentro do
sistema ClinicGest. Responda apenas com base nos dados retornados pelas
ferramentas disponíveis — nunca invente ou estime números.

Regras obrigatórias:
- Se a pergunta exigir um dado que nenhuma ferramenta fornece, diga
  claramente que essa informação não está disponível no sistema ainda, em
  vez de estimar ou supor.
- Sempre que citar um valor financeiro, ele deve vir diretamente do
  resultado de uma ferramenta chamada nesta conversa.
- Você não tem permissão para excluir, alterar ou movimentar dados —
  apenas ler e explicar. Se pedirem uma ação desse tipo, explique que ela
  precisa ser feita por um usuário humano no sistema.
- Você não é advogado nem contador; para questões jurídicas ou contábeis
  definitivas, recomende validação por um profissional habilitado.
- Seja direto e claro, como um relatório executivo — não um bate-papo.`;

const TOOLS = [
  {
    name: 'get_dashboard_summary',
    description: 'Retorna o resumo financeiro do período: saldo atual, faturamento bruto e recebido, contas a receber pendentes, contas vencidas e projeção de caixa em 30 dias.',
    input_schema: {
      type: 'object',
      properties: {
        periodStart: { type: 'string', description: 'Data inicial (AAAA-MM-DD)' },
        periodEnd: { type: 'string', description: 'Data final (AAAA-MM-DD)' },
      },
      required: ['periodStart', 'periodEnd'],
    },
  },
  {
    name: 'get_cash_projection',
    description: 'Projeta o saldo de caixa em um número de dias à frente, somando recebimentos e pagamentos previstos ainda não baixados.',
    input_schema: {
      type: 'object',
      properties: { horizonDays: { type: 'number', description: 'Janela em dias: 7, 15, 30, 60 ou 90' } },
      required: ['horizonDays'],
    },
  },
  {
    name: 'get_overdue_receivables',
    description: 'Lista os pacientes inadimplentes: contas a receber vencidas e não pagas, com dias de atraso.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_funnel_summary',
    description: 'Resumo do funil de vendas (CRM de leads): quantidade e valor potencial por etapa, e taxa de conversão geral.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_stale_leads',
    description: 'Lista leads sem interação registrada há mais de N horas (leads "esquecidos" no funil).',
    input_schema: {
      type: 'object',
      properties: { hours: { type: 'number', description: 'Horas sem interação (padrão 48)' } },
    },
  },
  {
    name: 'get_low_stock_items',
    description: 'Lista itens de estoque na quantidade mínima ou abaixo dela.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_patient_balance',
    description: 'Consulta o saldo financeiro pendente de um paciente específico e seus últimos agendamentos/orçamentos.',
    input_schema: {
      type: 'object',
      properties: { patientId: { type: 'string', description: 'UUID do paciente' } },
      required: ['patientId'],
    },
  },
];

/** Executa a tool solicitada pelo modelo. Nunca toca no banco fora dos services já testados. */
async function executeTool(client, clinicId, toolName, toolInput) {
  switch (toolName) {
    case 'get_dashboard_summary':
      return financialService.getDashboardSummary(client, clinicId, {
        periodStart: toolInput.periodStart, periodEnd: toolInput.periodEnd,
      });
    case 'get_cash_projection':
      return financialService.getCashProjection(client, clinicId, toolInput.horizonDays || 30);
    case 'get_overdue_receivables':
      return financialService.getOverdueReceivables(client, clinicId);
    case 'get_funnel_summary':
      return leadsService.getFunnelSummary(client, clinicId);
    case 'get_stale_leads':
      return leadsService.getStaleLeads(client, clinicId, toolInput.hours || 48);
    case 'get_low_stock_items':
      return inventoryService.getLowStockItems(client, clinicId);
    case 'get_patient_balance':
      return patientsService.getPatientProfile(client, clinicId, toolInput.patientId);
    default:
      throw new Error(`Ferramenta desconhecida: ${toolName}`);
  }
}

/**
 * Orquestra o loop de tool-use da API da Anthropic: envia a pergunta,
 * executa as ferramentas que o modelo pedir, devolve os resultados, e repete
 * até o modelo responder só com texto. Retorna a resposta final e o log de
 * ferramentas usadas (para transparência/auditoria de o que embasou a resposta).
 */
async function askFinancialAgent(client, { clinicId, question, apiKey, model, maxRounds = 6 }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const messages = [{ role: 'user', content: question }];
  const toolCallLog = [];

  for (let round = 0; round < maxRounds; round++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Falha na API da Anthropic (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    messages.push({ role: 'assistant', content: data.content });

    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      const textBlocks = data.content.filter((b) => b.type === 'text').map((b) => b.text);
      return { answer: textBlocks.join('\n'), toolCallLog };
    }

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      let isError = false;
      try {
        result = await executeTool(client, clinicId, block.name, block.input || {});
      } catch (err) {
        result = { error: err.message };
        isError = true;
      }
      toolCallLog.push({ tool: block.name, input: block.input, result });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Número máximo de rodadas de ferramentas atingido sem resposta final.');
}

module.exports = { TOOLS, executeTool, askFinancialAgent, SYSTEM_PROMPT };
