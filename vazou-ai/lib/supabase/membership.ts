import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Confirma que o usuário autenticado (via cookie de sessão) é membro ativo
 * de `companyId` ANTES de qualquer rota de servidor usar o cliente admin
 * (que faz bypass de RLS) para operar naquela empresa — ver lib/supabase/admin.ts.
 */
export async function assertMembership(companyId: string): Promise<{ userId: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("NOT_AUTHENTICATED");
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    throw new Error("NOT_A_MEMBER");
  }

  return { userId: user.id };
}
