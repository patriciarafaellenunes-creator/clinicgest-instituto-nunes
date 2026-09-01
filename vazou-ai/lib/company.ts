import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * MVP: um usuário opera uma única empresa por vez (a primeira membership
 * ativa encontrada). O schema já suporta múltiplas empresas por usuário
 * (`memberships`, §8) — um seletor de empresa ativa é item de V1.
 */
export async function getCurrentCompany() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("company_id, role, companies(id, name, segment, currency, timezone, status)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  return {
    userId: user.id,
    role: membership.role,
    company: membership.companies as unknown as {
      id: string;
      name: string;
      segment: string;
      currency: string;
      timezone: string;
      status: string;
    },
  };
}
