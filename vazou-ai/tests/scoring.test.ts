import { describe, expect, it } from "vitest";
import {
  computeTicketPercentile,
  hasSufficientData,
  priorityFromScore,
  scoreOpportunity,
  statusFromPriority,
  type ScoringInput,
} from "@/lib/scoring";

const NOW = new Date("2026-08-30T12:00:00Z");

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    signals: [],
    lastInteractionAt: null,
    potentialValueCents: null,
    ticketPercentile: null,
    negotiationStage: "primeiro_contato",
    interactionsCount: 0,
    now: NOW,
    ...overrides,
  };
}

describe("hasSufficientData / dados insuficientes (§7.5)", () => {
  it("é insuficiente sem interações", () => {
    expect(hasSufficientData(baseInput({ interactionsCount: 0, signals: ["vai_pensar"] }))).toBe(false);
  });

  it("é insuficiente com interação mas sem valor nem sinal", () => {
    expect(hasSufficientData(baseInput({ interactionsCount: 2 }))).toBe(false);
  });

  it("é suficiente com interação + valor potencial", () => {
    expect(
      hasSufficientData(baseInput({ interactionsCount: 1, potentialValueCents: 100000 })),
    ).toBe(true);
  });

  it("é suficiente com interação + ao menos um sinal", () => {
    expect(
      hasSufficientData(baseInput({ interactionsCount: 1, signals: ["vai_pensar"] })),
    ).toBe(true);
  });
});

describe("scoreOpportunity — casos sem dado suficiente", () => {
  it("retorna score/priority nulos e insufficientData=true", () => {
    const result = scoreOpportunity(baseInput());
    expect(result.score).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.breakdown).toBeNull();
    expect(result.insufficientData).toBe(true);
  });
});

describe("scoreOpportunity — cenário de referência (Mariana, R$3.500)", () => {
  // Orçamento enviado há 4 dias, sem follow-up, cliente perguntou parcelamento
  // — mesmo cenário do print de referência do dashboard (ALTA PRIORIDADE).
  it("classifica como alta prioridade", () => {
    const result = scoreOpportunity(
      baseInput({
        signals: ["pedido_parcelamento", "sem_followup"],
        lastInteractionAt: new Date("2026-08-26T12:00:00Z"), // 4 dias atrás
        potentialValueCents: 350000,
        ticketPercentile: 85,
        negotiationStage: "orcamento_enviado",
        interactionsCount: 4,
      }),
    );

    expect(result.insufficientData).toBe(false);
    expect(result.priority).toBe("alta");
    // intencao(25) + recencia 3-7d(14) + ticket top20%(15) + estagio(15)
    // + objecao contornavel(10) + interacoes 3+(8) + sem_followup(7) = 94
    expect(result.score).toBe(94);
    expect(result.breakdown).toEqual({
      intencao: 25,
      recencia: 14,
      ticket: 15,
      estagio: 15,
      objecao: 10,
      interacoes: 8,
      sem_followup: 7,
    });
  });
});

describe("scoreOpportunity — cenário frio", () => {
  it("classifica como baixa prioridade quando tudo é fraco", () => {
    const result = scoreOpportunity(
      baseInput({
        signals: [],
        lastInteractionAt: new Date("2026-06-01T12:00:00Z"), // >14 dias
        potentialValueCents: 5000,
        ticketPercentile: 10,
        negotiationStage: "primeiro_contato",
        interactionsCount: 1,
      }),
    );

    expect(result.insufficientData).toBe(false);
    // intencao(5) + recencia(3) + ticket(4) + estagio(4) + objecao sem(5)
    // + interacoes 1-2(4) + sem_followup(0) = 25
    expect(result.score).toBe(25);
    expect(result.priority).toBe("baixa");
  });
});

describe("scoreOpportunity — sem_followup só conta com sinal de intenção", () => {
  it("não soma o fator de follow-up sem intenção associada", () => {
    const withFollowupOnly = scoreOpportunity(
      baseInput({
        signals: ["sem_followup"],
        potentialValueCents: 100000,
        interactionsCount: 2,
      }),
    );
    const withFollowupAndIntent = scoreOpportunity(
      baseInput({
        signals: ["sem_followup", "intencao_explicita_compra"],
        potentialValueCents: 100000,
        interactionsCount: 2,
      }),
    );

    expect(withFollowupOnly.breakdown?.sem_followup).toBe(0);
    expect(withFollowupAndIntent.breakdown?.sem_followup).toBe(7);
  });
});

describe("priorityFromScore — faixas (§7.3)", () => {
  it.each([
    [100, "alta"],
    [70, "alta"],
    [69, "media"],
    [40, "media"],
    [39, "baixa"],
    [0, "baixa"],
  ] as const)("score %d -> %s", (score, expected) => {
    expect(priorityFromScore(score)).toBe(expected);
  });
});

describe("statusFromPriority — mapeamento score -> status (§7.4)", () => {
  it.each([
    ["alta", "quente"],
    ["media", "morno"],
    ["baixa", "frio"],
    [null, "recuperavel"],
  ] as const)("prioridade %s -> status %s", (priority, expected) => {
    expect(statusFromPriority(priority)).toBe(expected);
  });
});

describe("computeTicketPercentile", () => {
  it("retorna null sem histórico", () => {
    expect(computeTicketPercentile(1000, [])).toBeNull();
  });

  it("calcula a posição relativa dentro da própria empresa", () => {
    const history = [100, 200, 300, 400, 500];
    expect(computeTicketPercentile(500, history)).toBe(100);
    expect(computeTicketPercentile(100, history)).toBe(20);
    expect(computeTicketPercentile(300, history)).toBe(60);
  });
});
