"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export interface BusinessRuleState {
  error: string | null;
}

const RULE_TYPES = [
  "max_discount_pct",
  "payment_terms",
  "business_hours",
  "brand_voice",
  "no_promise_policy",
  "custom",
] as const;

export async function addBusinessRule(
  _prev: BusinessRuleState,
  formData: FormData,
): Promise<BusinessRuleState> {
  const companyId = String(formData.get("company_id") ?? "");
  const ruleType = String(formData.get("rule_type") ?? "");
  const description = String(formData.get("description") ?? "").trim();

  if (!RULE_TYPES.includes(ruleType as (typeof RULE_TYPES)[number])) {
    return { error: "Tipo de regra inválido." };
  }
  if (!description) {
    return { error: "Descreva a regra." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("business_rules").insert({
    company_id: companyId,
    rule_type: ruleType as (typeof RULE_TYPES)[number],
    description,
    value_json: { text: description },
  });

  if (error) {
    return { error: "Não foi possível salvar a regra." };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}

export async function toggleBusinessRule(formData: FormData): Promise<void> {
  const ruleId = String(formData.get("rule_id") ?? "");
  const active = formData.get("active") === "true";

  const supabase = await createServerSupabase();
  await supabase.from("business_rules").update({ active: !active }).eq("id", ruleId);

  revalidatePath("/configuracoes");
}
