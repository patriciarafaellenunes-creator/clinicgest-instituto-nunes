"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { generateRecoveryMessage } from "@/lib/claude";
import { formatCentsToBrl, parseBrlToCents } from "@/lib/money";

export interface OpportunityActionState {
  error: string | null;
  success: string | null;
}

/**
 * Gera a mensagem de recuperação sob demanda (§10.2-B do PRD) — só quando o
 * usuário pede, nunca automaticamente para todas as oportunidades (controle
 * de custo deliberado).
 */
export async function generateMessageAction(
  _prev: OpportunityActionState,
  formData: FormData,
): Promise<OpportunityActionState> {
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  const supabase = await createServerSupabase();

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, company_id, conversation_id, potential_value_cents, contacts(full_name)")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return { error: "Oportunidade não encontrada.", success: null };
  }

  const { data: signalRows } = await supabase
    .from("opportunity_signals")
    .select("signal_type")
    .eq("opportunity_id", opportunityId);

  const { data: businessRules } = await supabase
    .from("business_rules")
    .select("description")
    .eq("company_id", opportunity.company_id)
    .eq("active", true);

  const { data: messages } = opportunity.conversation_id
    ? await supabase
        .from("messages")
        .select("sender, content_text")
        .eq("conversation_id", opportunity.conversation_id)
        .order("sequence_index", { ascending: true })
    : { data: [] };

  const allowedFacts: string[] = [];
  if (opportunity.potential_value_cents !== null) {
    allowedFacts.push(`Valor mencionado na conversa: ${formatCentsToBrl(opportunity.potential_value_cents)}`);
  }
  for (const rule of businessRules ?? []) {
    if (rule.description) allowedFacts.push(rule.description);
  }

  const contactFirstName =
    ((opportunity.contacts as unknown as { full_name: string } | null)?.full_name ?? "cliente").split(
      " ",
    )[0] ?? "cliente";

  try {
    const result = await generateRecoveryMessage({
      contactFirstName,
      allowedFacts,
      signals: (signalRows ?? []).map((s) => s.signal_type),
      lastMessages: (messages ?? []).map(
        (m) => `${m.sender === "contact" ? "Cliente" : "Atendente"}: ${m.content_text}`,
      ),
    });

    await supabase.from("recovery_messages").insert({
      opportunity_id: opportunityId,
      generated_text: result.text,
      generated_by_model: result.model,
      prompt_version: result.promptVersion,
    });

    revalidatePath(`/oportunidades/${opportunityId}`);
    return { error: null, success: "Mensagem gerada." };
  } catch (err) {
    return {
      error: `Não foi possível gerar a mensagem agora: ${err instanceof Error ? err.message : "erro desconhecido"}`,
      success: null,
    };
  }
}

export async function registerRecoveredRevenueAction(
  _prev: OpportunityActionState,
  formData: FormData,
): Promise<OpportunityActionState> {
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  const amountCents = parseBrlToCents(String(formData.get("amount") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (amountCents === null || amountCents <= 0) {
    return { error: "Informe um valor recuperado válido.", success: null };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, company_id, status")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return { error: "Oportunidade não encontrada.", success: null };
  }

  const { error: insertError } = await supabase.from("recovered_revenue").insert({
    opportunity_id: opportunityId,
    company_id: opportunity.company_id,
    amount_cents: amountCents,
    notes,
    registered_by_user_id: user?.id ?? null,
  });

  if (insertError) {
    return { error: "Não foi possível registrar a receita recuperada.", success: null };
  }

  await supabase.from("opportunities").update({ status: "convertido" }).eq("id", opportunityId);
  await supabase.from("opportunity_status_history").insert({
    opportunity_id: opportunityId,
    from_status: opportunity.status,
    to_status: "convertido",
    changed_by: user?.id ?? "system",
    reason: "Receita recuperada registrada manualmente",
  });

  revalidatePath(`/oportunidades/${opportunityId}`);
  revalidatePath("/dashboard");
  revalidatePath("/oportunidades");

  return { error: null, success: `Registrado: ${formatCentsToBrl(amountCents)} recuperado.` };
}

export async function markAsLostAction(formData: FormData): Promise<void> {
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("status")
    .eq("id", opportunityId)
    .single();

  await supabase.from("opportunities").update({ status: "perdido" }).eq("id", opportunityId);
  await supabase.from("opportunity_status_history").insert({
    opportunity_id: opportunityId,
    from_status: opportunity?.status ?? null,
    to_status: "perdido",
    changed_by: user?.id ?? "system",
    reason: "Marcado manualmente como perdido",
  });

  revalidatePath(`/oportunidades/${opportunityId}`);
  revalidatePath("/dashboard");
  revalidatePath("/oportunidades");
}
