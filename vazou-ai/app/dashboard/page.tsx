import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { KpiCard, StatTile, PriorityBadge } from "@/components/Kpi";
import { getCurrentCompany } from "@/lib/company";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatCentsToBrl } from "@/lib/money";
import { getPlanCostCents } from "@/lib/plans";
import { PRIORITY_LABELS, REASON_DESCRIPTIONS } from "@/lib/labels";

export default async function DashboardPage() {
  const { company } = await getCurrentCompany();
  const supabase = await createServerSupabase();

  const [{ data: metrics }, { data: leaks }, { data: topOpportunities }] = await Promise.all([
    supabase.from("company_metrics_summary").select("*").eq("company_id", company.id).maybeSingle(),
    supabase
      .from("company_leak_breakdown")
      .select("*")
      .eq("company_id", company.id)
      .order("potential_value_cents", { ascending: false }),
    supabase
      .from("opportunities")
      .select(
        "id, potential_value_cents, priority, status, probable_reason, next_action_text, recovery_score, contacts(full_name)",
      )
      .eq("company_id", company.id)
      .in("status", ["recuperavel", "quente", "morno", "frio"])
      .order("recovery_score", { ascending: false, nullsFirst: false })
      .limit(5),
  ]);

  const potentialCents = metrics?.potential_revenue_identified_cents ?? 0;
  const recoveredCents = metrics?.recovered_revenue_cents ?? 0;
  const planCostCents = getPlanCostCents(company.status === "trial" ? "trial" : "basic");
  const roi = planCostCents > 0 ? recoveredCents / planCostCents : null;

  return (
    <AppShell companyName={company.name} activePath="/dashboard">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Bom dia! 👋</h1>
      <p className="mb-8 text-sm text-text-muted">
        Aqui está o que o VAZOU encontrou hoje na sua operação.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label="Receita potencial identificada"
          value={formatCentsToBrl(potentialCents)}
          sublabel={`${metrics?.open_opportunities_count ?? 0} oportunidades recuperáveis`}
          trend={`${metrics?.high_priority_count ?? 0} prioritárias`}
          tone="accent"
        />
        <KpiCard
          label="Recuperado com VAZOU.AI"
          value={formatCentsToBrl(recoveredCents)}
          sublabel="Receita registrada como recuperada"
          tone="accent"
        />
        <KpiCard
          label="ROI estimado"
          value={roi !== null ? `${roi.toFixed(1)}x` : "—"}
          sublabel={
            roi !== null
              ? `Para cada R$1 investido, ${formatCentsToBrl(Math.round(roi * 100))} foram recuperados`
              : "Cadastre um plano pago para calcular o ROI"
          }
          tone="accent-2"
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Onde seu dinheiro está vazando
          </h2>
          {leaks && leaks.length > 0 ? (
            <table className="w-full text-sm">
              <tbody>
                {leaks.map((leak) => (
                  <tr key={leak.probable_reason} className="border-b border-border last:border-0">
                    <td className="py-2.5">
                      <p className="font-medium">{PRIORITY_HEADLINE[leak.probable_reason] ?? leak.probable_reason}</p>
                      <p className="text-xs text-text-muted">{REASON_DESCRIPTIONS[leak.probable_reason]}</p>
                    </td>
                    <td className="py-2.5 text-center text-text-muted">{leak.opportunities_count}</td>
                    <td className="py-2.5 text-right font-mono font-semibold tabular">
                      {formatCentsToBrl(leak.potential_value_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState />
          )}
          <Link
            href="/importar"
            className="mt-4 block rounded-lg border border-accent/40 bg-accent-soft px-4 py-2.5 text-center text-sm font-semibold text-accent hover:opacity-90"
          >
            Importar mais conversas
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              Radar de oportunidades
            </h2>
            <Link href="/oportunidades" className="text-xs font-medium text-accent hover:underline">
              Ver todas →
            </Link>
          </div>
          {topOpportunities && topOpportunities.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {topOpportunities.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/oportunidades/${o.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/60 px-3.5 py-3 transition hover:border-accent/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {(o.contacts as unknown as { full_name: string } | null)?.full_name ?? "Contato"}
                      </p>
                      {o.priority && <PriorityBadge priority={o.priority} label={PRIORITY_LABELS[o.priority]} />}
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold tabular">
                      {formatCentsToBrl(o.potential_value_cents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Novas oportunidades (7 dias)" value={String(metrics?.new_opportunities_7d ?? 0)} />
        <StatTile
          label="Oportunidades sem follow-up"
          value={String(metrics?.without_followup_count ?? 0)}
        />
        <StatTile
          label="Ticket médio potencial"
          value={formatCentsToBrl(metrics?.ticket_medio_potential_cents ?? 0)}
        />
        <StatTile
          label="Revenue Leak Score"
          value={metrics?.revenue_leak_score !== null && metrics?.revenue_leak_score !== undefined ? `${metrics.revenue_leak_score}/100` : "—"}
          sublabel="Prioridade média das oportunidades ainda em aberto"
        />
      </div>
    </AppShell>
  );
}

const PRIORITY_HEADLINE: Record<string, string> = {
  sem_followup: "Sem follow-up",
  orcamento_sem_retorno: "Orçamento abandonado",
  objecao_preco: "Objeção não trabalhada",
  demora_resposta: "Demora no atendimento",
  vai_pensar: "Cliente disse que vai pensar",
  pedido_parcelamento: "Pediu parcelamento",
  pergunta_disponibilidade: "Perguntou disponibilidade",
  atendimento_abandonado: "Atendimento abandonado",
  intencao_explicita_compra: "Intenção explícita de compra",
  oportunidade_esquecida: "Oportunidade esquecida",
};

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-text-muted">
      Nenhuma oportunidade ainda. Importe suas primeiras conversas para começar.
    </div>
  );
}
