import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { classifyOpportunity } from "@/lib/claude";
import { computeTicketPercentile, scoreOpportunity, statusFromPriority } from "@/lib/scoring";
import type { NegotiationStage } from "@/lib/scoring";

/**
 * Worker de classificação (§2.3, §10 do PRD).
 *
 * MVP: processa a fila de forma síncrona, dentro da própria requisição que
 * disparou o import (ver lib/actions/import.ts) — suficiente para o volume
 * de uma PME pequena. A tabela `ai_processing_jobs` já modela a fila
 * corretamente; trocar isto por um worker de verdade (cron/Edge Function
 * batendo em /api/import/process) é um upgrade de infraestrutura de V1, não
 * uma mudança de schema — ver §2.2 do PRD.
 *
 * Aceita tanto o cliente com RLS (rota chamada por um usuário autenticado)
 * quanto o cliente admin/service-role (chamada futura por um cron externo) —
 * quem invoca é responsável por já ter validado que a operação está
 * autorizada para `companyId` (ver lib/supabase/membership.ts).
 */
/** Um job em `running` por mais que isto sem concluir é considerado travado e reprocessado. */
const STALE_RUNNING_MINUTES = 10;

export async function processQueuedJobs(
  supabase: SupabaseClient<Database>,
  companyId: string,
  limit = 50,
): Promise<{ processed: number; failed: number }> {
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000).toISOString();

  // Pega jobs `queued` normalmente, mas também jobs que ficaram presos em
  // `running` (ex: processo caiu no meio de uma classificação) — sem isso,
  // um job travado nunca seria pego de novo nem por esta função nem pela
  // rota de reprocessamento (POST /api/import/process).
  const { data: jobs, error: jobsError } = await supabase
    .from("ai_processing_jobs")
    .select("id, conversation_id")
    .eq("company_id", companyId)
    .eq("job_type", "classify")
    .or(`status.eq.queued,and(status.eq.running,created_at.lt.${staleCutoff})`)
    .limit(limit);

  if (jobsError || !jobs) {
    throw new Error(`FAILED_TO_LOAD_JOBS: ${jobsError?.message ?? "unknown"}`);
  }

  const { data: businessRules } = await supabase
    .from("business_rules")
    .select("rule_type, description, value_json")
    .eq("company_id", companyId)
    .eq("active", true);

  const businessRulesSummary = summarizeBusinessRules(businessRules ?? []);

  const { data: priorOpportunities } = await supabase
    .from("opportunities")
    .select("potential_value_cents")
    .eq("company_id", companyId)
    .not("potential_value_cents", "is", null);

  const valueHistory = (priorOpportunities ?? [])
    .map((o) => o.potential_value_cents)
    .filter((v): v is number => v !== null);

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (!job.conversation_id) {
        await markJobFailed(supabase, job.id, "JOB_WITHOUT_CONVERSATION");
        failed++;
        continue;
      }
      await processOneJob(supabase, companyId, job.id, job.conversation_id, businessRulesSummary, valueHistory);
      processed++;
    } catch (err) {
      await markJobFailed(supabase, job.id, err instanceof Error ? err.message : "UNKNOWN_ERROR");
      failed++;
    }
  }

  return { processed, failed };
}

async function processOneJob(
  supabase: SupabaseClient<Database>,
  companyId: string,
  jobId: string,
  conversationId: string,
  businessRulesSummary: string,
  valueHistory: number[],
): Promise<void> {
  await supabase.from("ai_processing_jobs").update({ status: "running" }).eq("id", jobId);

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, contact_id, last_message_at, contacts(full_name)")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    throw new Error(`CONVERSATION_NOT_FOUND: ${convError?.message ?? conversationId}`);
  }

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("sender, content_text, sent_at")
    .eq("conversation_id", conversationId)
    .order("sequence_index", { ascending: true });

  if (messagesError || !messages || messages.length === 0) {
    throw new Error(`NO_MESSAGES: ${messagesError?.message ?? conversationId}`);
  }

  const conversationText = messages
    .map((m) => `${m.sender === "contact" ? "Cliente" : "Atendente"}: ${m.content_text}`)
    .join("\n");

  const contactFirstName =
    ((conversation.contacts as unknown as { full_name: string } | null)?.full_name ?? "cliente").split(
      " ",
    )[0] ?? "cliente";

  // Valor já conhecido (dado explícito de importação) — se houver, entra
  // como candidato preferencial em vez de exigir que a IA o "encontre" de novo.
  const { data: existingOpportunity } = await supabase
    .from("opportunities")
    .select("id, potential_value_cents, status")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  const classification = await classifyOpportunity({
    contactFirstName,
    conversationText,
    businessRulesSummary,
    knownValueCents: existingOpportunity?.potential_value_cents ?? null,
  });

  const negotiationStage: NegotiationStage = classification.signals.includes("orcamento_sem_retorno")
    ? "orcamento_enviado"
    : classification.signals.length > 0
      ? "negociacao"
      : "primeiro_contato";

  const ticketPercentile =
    classification.potentialValueCents !== null
      ? computeTicketPercentile(classification.potentialValueCents, valueHistory)
      : null;

  const lastInteractionAt = conversation.last_message_at ?? messages[messages.length - 1]!.sent_at;

  const scoring = scoreOpportunity({
    signals: classification.signals,
    lastInteractionAt,
    potentialValueCents: classification.potentialValueCents,
    ticketPercentile,
    negotiationStage,
    interactionsCount: messages.length,
  });

  const status = classification.needsHumanReview ? "recuperavel" : statusFromPriority(scoring.priority);

  const opportunityPayload = {
    company_id: companyId,
    contact_id: conversation.contact_id,
    conversation_id: conversationId,
    potential_value_cents: classification.potentialValueCents,
    status,
    recovery_score: scoring.score,
    priority: scoring.priority,
    probable_reason: classification.probableReason,
    next_action_text: classification.recommendedNextAction,
    score_breakdown_json: scoring.breakdown ?? {},
    last_interaction_at: lastInteractionAt,
  };

  let opportunityId: string;
  if (existingOpportunity) {
    opportunityId = existingOpportunity.id;
    await supabase.from("opportunities").update(opportunityPayload).eq("id", opportunityId);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("opportunities")
      .insert(opportunityPayload)
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`FAILED_TO_INSERT_OPPORTUNITY: ${insertError?.message}`);
    }
    opportunityId = inserted.id;
  }

  if (existingOpportunity) {
    // Reclassificação (ex: via /api/import/process): descarta os sinais da
    // rodada anterior antes de gravar os novos, para não acumular sinais
    // duplicados/contraditórios de múltiplas classificações da mesma conversa.
    await supabase.from("opportunity_signals").delete().eq("opportunity_id", opportunityId);
  }

  if (classification.signals.length > 0) {
    await supabase.from("opportunity_signals").insert(
      classification.signals.map((signal_type) => ({
        opportunity_id: opportunityId,
        signal_type,
        confidence: classification.confidence,
      })),
    );
  }

  await supabase.from("opportunity_status_history").insert({
    opportunity_id: opportunityId,
    from_status: existingOpportunity?.status ?? null,
    to_status: status,
    changed_by: "ai",
    reason: `Classificação automática (${classification.probableReason})`,
  });

  await supabase
    .from("ai_processing_jobs")
    .update({
      status: classification.needsHumanReview ? "needs_review" : "done",
      model: classification.model,
      prompt_version: classification.promptVersion,
      input_tokens: classification.usage.inputTokens,
      output_tokens: classification.usage.outputTokens,
      cost_usd_estimate: estimateCostUsd(classification.usage.inputTokens, classification.usage.outputTokens),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await supabase.from("ai_call_logs").insert({
    job_id: jobId,
    company_id: companyId,
    request_summary_json: { message_count: messages.length, business_rules_used: businessRulesSummary },
    response_json: {
      signals: classification.signals,
      probable_reason: classification.probableReason,
      confidence: classification.confidence,
      needs_human_review: classification.needsHumanReview,
    },
  });
}

async function markJobFailed(supabase: SupabaseClient<Database>, jobId: string, error: string) {
  await supabase
    .from("ai_processing_jobs")
    .update({ status: "failed", error, completed_at: new Date().toISOString() })
    .eq("id", jobId);
}

function summarizeBusinessRules(
  rules: Array<{ rule_type: string; description: string | null; value_json: unknown }>,
): string {
  if (rules.length === 0) {
    return "Nenhuma regra comercial cadastrada. Não ofereça desconto, prazo ou condição de pagamento algum.";
  }
  return rules.map((r) => `- ${r.description ?? r.rule_type}`).join("\n");
}

/** Estimativa aproximada — ver §11 do PRD; ajustar quando o preço do modelo mudar. */
function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const inputCostPerMillion = 5.0;
  const outputCostPerMillion = 25.0;
  return (inputTokens / 1_000_000) * inputCostPerMillion + (outputTokens / 1_000_000) * outputCostPerMillion;
}
