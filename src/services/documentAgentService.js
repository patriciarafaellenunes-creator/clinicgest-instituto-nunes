// src/services/documentAgentService.js
//
// Agente de IA documental (seção 13 do documento 3) — mesmo princípio do
// agente financeiro (aiAgentService.js): só responde através de ferramentas
// que leem dados reais, nunca inventa. A seção 13 é explícita: "o agente
// pode gerar minutas, preencher campos e sugerir cláusulas, mas não deve
// apresentar documentos como juridicamente validados sem revisão
// profissional" e "nunca alterar ou assinar documentos sozinho, exigir
// autorização humana para ações críticas". Por isso este agente também é
// somente leitura — igual ao financeiro, a garantia é estrutural (não tem
// ferramenta de escrita), não apenas uma instrução no prompt.

const documentsService = require('./documentsService');
const patientFilesService = require('./patientFilesService');
const professionalContractService = require('./professionalContractService');

const SYSTEM_PROMPT = `Você é o assistente documental de uma clínica odontológica, dentro do
sistema ClinicGest. Responda apenas com base nos dados retornados pelas
ferramentas disponíveis — nunca invente prazos, nomes ou status de documentos.

Regras obrigatórias:
- Se a pergunta exigir um dado que nenhuma ferramenta fornece, diga
  claramente que essa informação não está disponível no sistema ainda.
- Você pode ajudar a entender o que falta ou o que está pendente, e pode
  sugerir minutas ou cláusulas quando pedido — mas sempre deixe claro que
  documentos gerados ou sugeridos por você precisam de revisão por um
  profissional habilitado (jurídico/contábil/técnico) antes de uso
  definitivo, e nunca devem ser tratados como juridicamente validados só
  porque vieram de você.
- Você não tem permissão para assinar, cancelar ou alterar documentos —
  apenas ler e explicar. Ações desse tipo precisam ser feitas por um
  usuário humano no sistema.
- Seja direto e claro, como um relatório executivo.`;

const TOOLS = [
  {
    name: 'get_pending_signatures',
    description: 'Lista assinaturas pendentes (documentos aguardando assinatura de algum signatário). Pode ser filtrado por paciente.',
    input_schema: {
      type: 'object',
      properties: { patientId: { type: 'string', description: 'UUID do paciente (opcional, filtra só esse paciente)' } },
    },
  },
  {
    name: 'get_expiring_documents',
    description: 'Lista contratos/termos vigentes que vencem dentro de N dias.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Janela em dias (padrão 30)' } },
    },
  },
  {
    name: 'get_required_templates_overview',
    description: 'Lista quais procedimentos ou especialidades exigem um termo de consentimento específico configurado no sistema.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_suppliers_without_active_contract',
    description: 'Lista fornecedores ou laboratórios que não têm nenhum contrato assinado e vigente no sistema.',
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', description: '"contrato_fornecedor" ou "contrato_laboratorio" (opcional)' } },
    },
  },
  {
    name: 'get_unauthorized_images',
    description: 'Lista pacientes com fotos/vídeos clínicos registrados sem autorização de uso de imagem.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_appointments_missing_documents',
    description: 'Lista agendamentos nos próximos N dias cujo paciente ainda não tem toda a documentação obrigatória assinada para o procedimento marcado.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Janela em dias à frente (padrão 7)' } },
    },
  },
  {
    name: 'get_professional_authorization',
    description: 'Verifica se um profissional está autorizado (pelo contrato assinado) para um procedimento ou especialidade específica.',
    input_schema: {
      type: 'object',
      properties: {
        professionalId: { type: 'string', description: 'UUID do profissional' },
        specialty: { type: 'string', description: 'Nome da especialidade (opcional)' },
        procedureId: { type: 'string', description: 'UUID do procedimento (opcional)' },
      },
      required: ['professionalId'],
    },
  },
];

async function executeTool(client, clinicId, toolName, toolInput) {
  switch (toolName) {
    case 'get_pending_signatures':
      return documentsService.getPendingSignatures(client, clinicId, { patientId: toolInput.patientId });
    case 'get_expiring_documents':
      return documentsService.getExpiringDocuments(client, clinicId, toolInput.days || 30);
    case 'get_required_templates_overview':
      return documentsService.getRequiredTemplatesOverview(client, clinicId);
    case 'get_suppliers_without_active_contract':
      return documentsService.getSuppliersWithoutActiveContract(client, clinicId, { category: toolInput.category });
    case 'get_unauthorized_images':
      return patientFilesService.getUnauthorizedImagesClinicWide(client, clinicId);
    case 'get_appointments_missing_documents':
      return documentsService.getAppointmentsMissingDocuments(client, clinicId, toolInput.days || 7);
    case 'get_professional_authorization':
      return professionalContractService.isProfessionalAuthorized(client, clinicId, toolInput.professionalId, {
        specialty: toolInput.specialty, procedureId: toolInput.procedureId,
      });
    default:
      throw new Error(`Ferramenta desconhecida: ${toolName}`);
  }
}

/** Mesmo loop de tool-use do agente financeiro — ver aiAgentService.js para o raciocínio completo por trás da orquestração. */
async function askDocumentAgent(client, { clinicId, question, apiKey, model, maxRounds = 6 }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const messages = [{ role: 'user', content: question }];
  const toolCallLog = [];

  for (let round = 0; round < maxRounds; round++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
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
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result), is_error: isError });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Número máximo de rodadas de ferramentas atingido sem resposta final.');
}

module.exports = { TOOLS, executeTool, askDocumentAgent, SYSTEM_PROMPT };
