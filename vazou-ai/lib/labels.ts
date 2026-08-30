import type { Priority, ProbableReason, SignalType } from "@/lib/supabase/types";

export const SIGNAL_LABELS: Record<SignalType, string> = {
  sem_followup: "Sem follow-up",
  demora_resposta: "Demora no atendimento",
  orcamento_sem_retorno: "Orçamento abandonado",
  objecao_preco: "Objeção de preço",
  pedido_parcelamento: "Pediu parcelamento",
  vai_pensar: "Disse que vai pensar",
  pergunta_disponibilidade: "Perguntou disponibilidade",
  atendimento_abandonado: "Atendimento abandonado",
  intencao_explicita_compra: "Intenção explícita de compra",
  oportunidade_esquecida: "Oportunidade esquecida",
};

export const REASON_DESCRIPTIONS: Record<ProbableReason, string> = {
  sem_followup: "Clientes que não receberam novo contato",
  demora_resposta: "Tempo de resposta acima do ideal",
  orcamento_sem_retorno: "Orçamentos enviados sem retorno",
  objecao_preco: "Cliente levantou objeção de preço",
  pedido_parcelamento: "Cliente pediu para parcelar",
  vai_pensar: "Cliente disse que vai pensar",
  pergunta_disponibilidade: "Cliente perguntou disponibilidade",
  atendimento_abandonado: "Atendimento foi abandonado",
  intencao_explicita_compra: "Cliente demonstrou intenção clara de compra",
  oportunidade_esquecida: "Oportunidade ficou esquecida",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  alta: "ALTA PRIORIDADE",
  media: "OPORTUNIDADE",
  baixa: "ATENÇÃO",
};

export const STATUS_LABELS: Record<string, string> = {
  recuperavel: "Recuperável",
  quente: "Quente",
  morno: "Morno",
  frio: "Frio",
  perdido: "Perdido",
  convertido: "Convertido",
};
