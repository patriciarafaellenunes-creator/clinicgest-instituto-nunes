import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { assertMembership } from "@/lib/supabase/membership";
import { processQueuedJobs } from "@/lib/ai/processJobs";

/** Comparação em tempo constante — evita vazar o segredo por diferença de latência. */
function isValidCronSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Reprocessa jobs de classificação ainda `queued` para uma empresa.
 *
 * A importação (lib/actions/import.ts) já processa a fila de forma síncrona
 * no MVP — esta rota existe para (a) reprocessar jobs que ficaram presos
 * (ex: falha transitória da Claude API) e (b) ser o ponto de entrada que um
 * cron/Edge Function de V1 passa a chamar em vez do processamento síncrono,
 * sem precisar mudar nada no worker em si (lib/ai/processJobs.ts).
 *
 * Autenticação: sessão de um membro ativo da empresa (cookie), OU um
 * cron autorizado via `x-cron-secret` (ver CRON_SECRET no .env).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { companyId?: string } | null;
  const companyId = body?.companyId;

  if (!companyId) {
    return NextResponse.json({ error: "companyId é obrigatório" }, { status: 400 });
  }

  const cronSecret = request.headers.get("x-cron-secret");
  const isCron = isValidCronSecret(cronSecret, process.env.CRON_SECRET);

  if (!isCron) {
    try {
      await assertMembership(companyId);
    } catch {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  const supabase = createAdminSupabase();

  try {
    const result = await processQueuedJobs(supabase, companyId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro desconhecido" },
      { status: 500 },
    );
  }
}
