import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PriorityBadge } from "@/components/Kpi";
import { getCurrentCompany } from "@/lib/company";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatCentsToBrl } from "@/lib/money";
import { PRIORITY_LABELS, REASON_DESCRIPTIONS } from "@/lib/labels";

const FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "alta_prioridade", label: "🔥 Prioridade alta" },
  { key: "sem_followup", label: "Sem follow-up" },
  { key: "orcamentos", label: "Orçamentos" },
  { key: "esquecidos", label: "Esquecidos" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default async function OportunidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const { company } = await getCurrentCompany();
  const { filtro } = await searchParams;
  const activeFilter = (FILTERS.find((f) => f.key === filtro)?.key ?? "todas") as FilterKey;

  const supabase = await createServerSupabase();

  let query = supabase
    .from("opportunities")
    .select(
      "id, potential_value_cents, priority, status, probable_reason, recovery_score, last_interaction_at, contacts(full_name)",
    )
    .eq("company_id", company.id)
    .in("status", ["recuperavel", "quente", "morno", "frio"])
    .order("recovery_score", { ascending: false, nullsFirst: false });

  if (activeFilter === "alta_prioridade") query = query.eq("priority", "alta");
  if (activeFilter === "orcamentos") query = query.eq("probable_reason", "orcamento_sem_retorno");
  if (activeFilter === "esquecidos") query = query.eq("probable_reason", "oportunidade_esquecida");

  const { data: opportunities } = await query;

  let filtered = opportunities ?? [];
  if (activeFilter === "sem_followup") {
    const { data: withSignal } = await supabase
      .from("opportunity_signals")
      .select("opportunity_id")
      .eq("signal_type", "sem_followup");
    const idsWithSignal = new Set((withSignal ?? []).map((s) => s.opportunity_id));
    filtered = filtered.filter((o) => idsWithSignal.has(o.id));
  }

  return (
    <AppShell companyName={company.name} activePath="/oportunidades">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Radar de oportunidades</h1>
          <p className="text-sm text-text-muted">{filtered.length} oportunidade(s) encontradas.</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "todas" ? "/oportunidades" : `/oportunidades?filtro=${f.key}`}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              activeFilter === f.key
                ? "bg-accent text-bg"
                : "border border-border bg-surface text-text-muted hover:text-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-text-muted">
          Nenhuma oportunidade neste filtro.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((o) => (
            <Link
              key={o.id}
              href={`/oportunidades/${o.id}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 transition hover:border-accent/40"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {(o.contacts as unknown as { full_name: string } | null)?.full_name ?? "Contato"}
                </p>
                <p className="truncate text-sm text-text-muted">
                  {o.probable_reason ? REASON_DESCRIPTIONS[o.probable_reason] : "Aguardando classificação"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="font-mono text-sm font-semibold tabular">
                  {formatCentsToBrl(o.potential_value_cents)}
                </span>
                {o.priority ? (
                  <PriorityBadge priority={o.priority} label={PRIORITY_LABELS[o.priority]} />
                ) : (
                  <span className="text-xs text-text-muted">Dados insuficientes</span>
                )}
                <span className="w-20 text-right text-xs text-text-muted">
                  {o.recovery_score !== null ? `Score ${o.recovery_score}` : "—"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
