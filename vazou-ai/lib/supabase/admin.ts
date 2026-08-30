import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Cliente com a service role key — faz BYPASS de RLS (§8 do PRD).
 *
 * Regra de código, não de banco: toda query feita com este cliente PRECISA
 * ser explicitamente filtrada por `company_id`. Nunca usar este cliente em
 * uma rota acionável pelo client sem antes confirmar que o usuário
 * autenticado é membro ativo daquela empresa (ver `assertMembership`).
 */
export function createAdminSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
