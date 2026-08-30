import type { OpportunityStatus, Priority, SignalType } from "@/lib/supabase/types";

/**
 * Recovery Score — regras transparentes de 0 a 100 (§7 do PRD).
 *
 * Isto é uma heurística auditável, não uma previsão estatística: cada fator
 * é somado com um peso fixo e documentado, e o detalhamento
 * (`ScoringResult.breakdown`) é exatamente o que a tela de oportunidade
 * mostra ao usuário. Nunca adicione um fator "mágico" aqui sem também
 * documentá-lo em vazou-ai/docs/00-prd-arquitetura.md §7.
 */

export type NegotiationStage = "orcamento_enviado" | "negociacao" | "primeiro_contato";

const STRONG_INTENT_SIGNALS: SignalType[] = [
  "intencao_explicita_compra",
  "pedido_parcelamento",
];
const MODERATE_INTENT_SIGNALS: SignalType[] = ["pergunta_disponibilidade"];
const CONTORNAVEL_OBJECTION_SIGNALS: SignalType[] = [
  "objecao_preco",
  "pedido_parcelamento",
  "vai_pensar",
];

export interface ScoringInput {
  signals: SignalType[];
  /** Data/hora da última interação registrada na conversa. `null` = desconhecida. */
  lastInteractionAt: Date | string | null;
  /** Valor potencial identificado, em centavos. `null` = não identificado. */
  potentialValueCents: number | null;
  /**
   * Posição do valor potencial na distribuição de tickets DESTA empresa
   * (0–100). Deve ser calculado pelo chamador (nunca um valor absoluto
   * cravado — §7.2). `null` quando não há dado suficiente para calcular.
   */
  ticketPercentile: number | null;
  negotiationStage: NegotiationStage;
  interactionsCount: number;
  /** Injetável nos testes; padrão = agora. */
  now?: Date;
}

export interface ScoringBreakdown {
  intencao: number;
  recencia: number;
  ticket: number;
  estagio: number;
  objecao: number;
  interacoes: number;
  sem_followup: number;
}

export interface ScoringResult {
  /** `null` quando não há dado suficiente — nunca force um número (§7.5). */
  score: number | null;
  priority: Priority | null;
  breakdown: ScoringBreakdown | null;
  insufficientData: boolean;
}

function hasAny(signals: SignalType[], candidates: SignalType[]): boolean {
  return candidates.some((c) => signals.includes(c));
}

function daysSince(date: Date, now: Date): number {
  const ms = now.getTime() - date.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function scoreIntencao(signals: SignalType[]): number {
  if (hasAny(signals, STRONG_INTENT_SIGNALS)) return 25;
  if (hasAny(signals, MODERATE_INTENT_SIGNALS)) return 15;
  return 5;
}

function scoreRecencia(lastInteractionAt: Date | string | null, now: Date): number {
  if (!lastInteractionAt) return 3;
  const date = typeof lastInteractionAt === "string" ? new Date(lastInteractionAt) : lastInteractionAt;
  const days = daysSince(date, now);
  if (days <= 2) return 20;
  if (days <= 7) return 14;
  if (days <= 14) return 8;
  return 3;
}

function scoreTicket(ticketPercentile: number | null): number {
  if (ticketPercentile === null) return 0;
  if (ticketPercentile >= 80) return 15;
  if (ticketPercentile >= 40) return 9;
  return 4;
}

function scoreEstagio(stage: NegotiationStage): number {
  switch (stage) {
    case "orcamento_enviado":
      return 15;
    case "negociacao":
      return 10;
    case "primeiro_contato":
      return 4;
  }
}

function scoreObjecao(signals: SignalType[]): number {
  return hasAny(signals, CONTORNAVEL_OBJECTION_SIGNALS) ? 10 : 5;
}

function scoreInteracoes(count: number): number {
  if (count >= 3) return 8;
  if (count >= 1) return 4;
  return 0;
}

function scoreSemFollowup(signals: SignalType[], intencaoScore: number): number {
  const hasIntent = intencaoScore > 5;
  return signals.includes("sem_followup") && hasIntent ? 7 : 0;
}

export function priorityFromScore(score: number): Priority {
  if (score >= 70) return "alta";
  if (score >= 40) return "media";
  return "baixa";
}

/**
 * Dados mínimos para um score confiável: pelo menos uma interação
 * registrada e (um valor potencial OU pelo menos um sinal identificado).
 * Abaixo disso, a tela deve mostrar "dados insuficientes" em vez de um
 * número (§7.5) — nunca estimar sem base.
 */
export function hasSufficientData(input: ScoringInput): boolean {
  const hasValueOrSignal = input.potentialValueCents !== null || input.signals.length > 0;
  return input.interactionsCount >= 1 && hasValueOrSignal;
}

export function scoreOpportunity(input: ScoringInput): ScoringResult {
  if (!hasSufficientData(input)) {
    return { score: null, priority: null, breakdown: null, insufficientData: true };
  }

  const now = input.now ?? new Date();
  const intencao = scoreIntencao(input.signals);
  const recencia = scoreRecencia(input.lastInteractionAt, now);
  const ticket = scoreTicket(input.ticketPercentile);
  const estagio = scoreEstagio(input.negotiationStage);
  const objecao = scoreObjecao(input.signals);
  const interacoes = scoreInteracoes(input.interactionsCount);
  const sem_followup = scoreSemFollowup(input.signals, intencao);

  const total = intencao + recencia + ticket + estagio + objecao + interacoes + sem_followup;
  const score = Math.max(0, Math.min(100, total));

  return {
    score,
    priority: priorityFromScore(score),
    breakdown: { intencao, recencia, ticket, estagio, objecao, interacoes, sem_followup },
    insufficientData: false,
  };
}

/**
 * Mapeamento score -> status (§7.4): quente/morno/frio são a mesma coisa
 * que as faixas de prioridade, para oportunidades ainda ativas. Sem dado
 * suficiente para um score, a oportunidade fica no guarda-chuva
 * "recuperavel" até haver base para distinguir a faixa.
 */
export function statusFromPriority(priority: Priority | null): OpportunityStatus {
  switch (priority) {
    case "alta":
      return "quente";
    case "media":
      return "morno";
    case "baixa":
      return "frio";
    default:
      return "recuperavel";
  }
}

/**
 * Percentil (0–100) de `value` dentro de `allValues` (mesma empresa) —
 * usado para o fator "ticket" (§7.2), sempre relativo, nunca absoluto.
 */
export function computeTicketPercentile(value: number, allValues: number[]): number | null {
  if (allValues.length === 0) return null;
  const below = allValues.filter((v) => v <= value).length;
  return Math.round((below / allValues.length) * 100);
}
