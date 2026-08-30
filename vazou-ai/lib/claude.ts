import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ProbableReason, SignalType } from "@/lib/supabase/types";

/**
 * Integração com a Claude API (§10 do PRD).
 *
 * Princípio central: a IA nunca inventa fato comercial. As duas funções
 * abaixo forçam saída ESTRUTURADA via tool use (nunca texto livre
 * interpretado "na confiança"), e `generateRecoveryMessage` exige que o
 * modelo cite explicitamente de onde tirou cada afirmação da mensagem
 * (`factsUsed`), a partir de uma lista fechada de fatos permitidos.
 */

const SIGNAL_TYPES: SignalType[] = [
  "sem_followup",
  "demora_resposta",
  "orcamento_sem_retorno",
  "objecao_preco",
  "pedido_parcelamento",
  "vai_pensar",
  "pergunta_disponibilidade",
  "atendimento_abandonado",
  "intencao_explicita_compra",
  "oportunidade_esquecida",
];

export const PROMPT_VERSION = "2026-08-v1";

function getClient(): Anthropic {
  return new Anthropic();
}

// Modelo mais capaz disponível por padrão (recomendação vigente da Anthropic
// no momento da implementação) — nunca reduzido silenciosamente por custo;
// ajustável apenas via variável de ambiente, por decisão explícita de quem
// opera o produto (§10.3 do PRD).
const CLASSIFY_MODEL = process.env.ANTHROPIC_CLASSIFY_MODEL ?? "claude-opus-5";
const MESSAGE_MODEL = process.env.ANTHROPIC_MESSAGE_MODEL ?? "claude-opus-5";

const CLASSIFY_SYSTEM_PROMPT = `Você é o motor de classificação do VAZOU.AI, um produto de \
Revenue Recovery para pequenas e médias empresas que vendem por conversa.

Sua única tarefa é ler uma conversa comercial e extrair, de forma estritamente \
grounded no texto fornecido, os sinais comerciais presentes, o motivo mais \
provável da oportunidade estar parada, e a próxima ação recomendada.

Regras inegociáveis:
- NUNCA invente um valor monetário que não apareça literalmente no texto da \
conversa. Se nenhum valor for mencionado, retorne potential_value_cents como null.
- NUNCA invente desconto, prazo, condição de pagamento ou promessa comercial.
- Só marque um sinal como presente se houver evidência textual razoável dele.
- Se a conversa for ambígua ou curta demais para uma classificação confiável, \
retorne confidence="baixa" e needs_human_review=true em vez de forçar uma \
classificação.
- Valores monetários, quando extraídos, devem vir em CENTAVOS (ex: R$ 3.500,00 = 350000).`;

const MESSAGE_SYSTEM_PROMPT = `Você é o Copiloto de Recuperação do VAZOU.AI. Sua tarefa é \
escrever uma mensagem curta, humana e contextualizada para retomar contato com um \
cliente que parou de responder — usando exclusivamente os fatos fornecidos em \
"allowed_facts" e nada além disso.

Regras inegociáveis:
- NUNCA crie desconto, condição de parcelamento, prazo ou preço que não esteja \
literalmente em allowed_facts.
- Cite em facts_used exatamente quais itens de allowed_facts você usou.
- Se não houver fatos suficientes para uma mensagem específica, escreva uma \
mensagem mais genérica de retomada de contato (nunca invente para compensar a \
falta de dado) e marque needs_more_info=true.
- Tom: cordial, direto, sem parecer um robô. Uma mensagem de WhatsApp real, curta \
(3-5 frases no máximo).`;

export interface ClassifyOpportunityInput {
  contactFirstName: string;
  conversationText: string;
  businessRulesSummary: string;
  /** Valor já conhecido por dado explícito de importação, se houver. */
  knownValueCents: number | null;
}

export interface ClassifyOpportunityResult {
  signals: SignalType[];
  probableReason: ProbableReason;
  potentialValueCents: number | null;
  recommendedNextAction: string;
  confidence: "baixa" | "media" | "alta";
  needsHumanReview: boolean;
  model: string;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number };
}

const classifyTool: Anthropic.Tool = {
  name: "classify_opportunity",
  description:
    "Registra a classificação estruturada de uma oportunidade a partir da conversa fornecida.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      signals: {
        type: "array",
        items: { type: "string", enum: SIGNAL_TYPES },
        description: "Sinais comerciais identificados com evidência textual na conversa.",
      },
      probable_reason: {
        type: "string",
        enum: SIGNAL_TYPES,
        description: "Motivo único mais provável da oportunidade estar parada.",
      },
      potential_value_cents: {
        type: ["integer", "null"],
        description: "Valor em centavos SE explicitamente mencionado no texto; caso contrário null.",
      },
      recommended_next_action: {
        type: "string",
        description: "Próxima ação recomendada, em poucas palavras (ex: 'Retomar contato').",
      },
      confidence: { type: "string", enum: ["baixa", "media", "alta"] },
      needs_human_review: { type: "boolean" },
    },
    required: [
      "signals",
      "probable_reason",
      "potential_value_cents",
      "recommended_next_action",
      "confidence",
      "needs_human_review",
    ],
    additionalProperties: false,
  },
};

/** Confere se um valor citado pela IA aparece de fato no texto de origem (grounding). */
function valueAppearsInText(valueCents: number, text: string): boolean {
  const reais = Math.floor(valueCents / 100);
  const patterns = [
    reais.toString(),
    reais.toLocaleString("pt-BR"),
    (valueCents / 100).toFixed(2).replace(".", ","),
  ];
  return patterns.some((p) => text.includes(p));
}

export async function classifyOpportunity(
  input: ClassifyOpportunityInput,
): Promise<ClassifyOpportunityResult> {
  const client = getClient();

  const userPayload = {
    contact_first_name: input.contactFirstName,
    known_value_cents: input.knownValueCents,
    business_rules: input.businessRulesSummary,
    conversation: input.conversationText,
  };

  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    system: [
      {
        type: "text",
        text: CLASSIFY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [classifyTool],
    tool_choice: { type: "tool", name: "classify_opportunity" },
    messages: [{ role: "user", content: JSON.stringify(userPayload) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("CLAUDE_NO_TOOL_USE");
  }

  const raw = toolUse.input as {
    signals: SignalType[];
    probable_reason: ProbableReason;
    potential_value_cents: number | null;
    recommended_next_action: string;
    confidence: "baixa" | "media" | "alta";
    needs_human_review: boolean;
  };

  // Grounding extra: se a IA "extraiu" um valor que não está literalmente no
  // texto, descartamos e sinalizamos para revisão humana — nunca confiamos
  // cegamente na saída, mesmo estruturada (§10.1).
  let potentialValueCents = raw.potential_value_cents ?? input.knownValueCents;
  let needsHumanReview = raw.needs_human_review;
  if (
    raw.potential_value_cents !== null &&
    !valueAppearsInText(raw.potential_value_cents, input.conversationText)
  ) {
    potentialValueCents = input.knownValueCents;
    needsHumanReview = true;
  }

  return {
    signals: raw.signals,
    probableReason: raw.probable_reason,
    potentialValueCents,
    recommendedNextAction: raw.recommended_next_action,
    confidence: raw.confidence,
    needsHumanReview,
    model: CLASSIFY_MODEL,
    promptVersion: PROMPT_VERSION,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export interface GenerateRecoveryMessageInput {
  contactFirstName: string;
  /** Lista fechada de fatos que o modelo TEM PERMISSÃO de citar. */
  allowedFacts: string[];
  signals: SignalType[];
  lastMessages: string[];
  tone?: string;
}

export interface GenerateRecoveryMessageResult {
  text: string;
  factsUsed: string[];
  needsMoreInfo: boolean;
  model: string;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number };
}

const messageTool: Anthropic.Tool = {
  name: "generate_recovery_message",
  description: "Registra a mensagem de recuperação gerada e os fatos usados para escrevê-la.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      message_text: { type: "string" },
      facts_used: {
        type: "array",
        items: { type: "string" },
        description: "Subconjunto literal de allowed_facts efetivamente citado na mensagem.",
      },
      needs_more_info: { type: "boolean" },
    },
    required: ["message_text", "facts_used", "needs_more_info"],
    additionalProperties: false,
  },
};

export async function generateRecoveryMessage(
  input: GenerateRecoveryMessageInput,
): Promise<GenerateRecoveryMessageResult> {
  const client = getClient();

  const userPayload = {
    contact_first_name: input.contactFirstName,
    allowed_facts: input.allowedFacts,
    signals: input.signals,
    last_messages: input.lastMessages,
    tone: input.tone ?? "cordial e direto",
  };

  const response = await client.messages.create({
    model: MESSAGE_MODEL,
    max_tokens: 1024,
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: MESSAGE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [messageTool],
    tool_choice: { type: "tool", name: "generate_recovery_message" },
    messages: [{ role: "user", content: JSON.stringify(userPayload) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("CLAUDE_NO_TOOL_USE");
  }

  const raw = toolUse.input as {
    message_text: string;
    facts_used: string[];
    needs_more_info: boolean;
  };

  return {
    text: raw.message_text,
    factsUsed: raw.facts_used,
    needsMoreInfo: raw.needs_more_info,
    model: MESSAGE_MODEL,
    promptVersion: PROMPT_VERSION,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
