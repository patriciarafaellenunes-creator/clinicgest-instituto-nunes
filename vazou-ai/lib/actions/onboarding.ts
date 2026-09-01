"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Segment } from "@/lib/supabase/types";

export interface OnboardingState {
  error: string | null;
}

export async function createCompany(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const segment = String(formData.get("segment") ?? "outro") as Segment;
  const currency = String(formData.get("currency") ?? "BRL");
  const timezone = String(formData.get("timezone") ?? "America/Sao_Paulo");

  if (!name) {
    return { error: "Informe o nome da empresa." };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name, segment, currency, timezone })
    .select("id")
    .single();

  if (companyError || !company) {
    return { error: "Não foi possível criar a empresa. Tente novamente." };
  }

  const { error: membershipError } = await supabase.from("memberships").insert({
    company_id: company.id,
    user_id: user.id,
    role: "owner",
    status: "active",
  });

  if (membershipError) {
    return { error: "Empresa criada, mas houve um erro ao vincular seu usuário. Contate o suporte." };
  }

  await supabase.from("user_profiles").upsert({
    id: user.id,
    full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
  });

  const maxDiscountPct = formData.get("max_discount_pct");
  const paymentTerms = String(formData.get("payment_terms") ?? "").trim();
  const brandVoice = String(formData.get("brand_voice") ?? "").trim();

  type RuleType = "max_discount_pct" | "payment_terms" | "brand_voice";
  const rules: Array<{ rule_type: RuleType; value_json: Record<string, unknown>; description: string }> = [];
  if (maxDiscountPct && Number(maxDiscountPct) > 0) {
    rules.push({
      rule_type: "max_discount_pct",
      value_json: { pct: Number(maxDiscountPct) },
      description: `Desconto máximo autorizado: ${maxDiscountPct}%`,
    });
  }
  if (paymentTerms) {
    rules.push({
      rule_type: "payment_terms",
      value_json: { text: paymentTerms },
      description: paymentTerms,
    });
  }
  if (brandVoice) {
    rules.push({
      rule_type: "brand_voice",
      value_json: { text: brandVoice },
      description: brandVoice,
    });
  }

  if (rules.length > 0) {
    await supabase
      .from("business_rules")
      .insert(rules.map((r) => ({ ...r, company_id: company.id })));
  }

  redirect("/dashboard");
}
