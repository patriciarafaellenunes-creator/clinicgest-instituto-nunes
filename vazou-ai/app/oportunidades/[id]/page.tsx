import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PriorityBadge } from "@/components/Kpi";
import { getCurrentCompany } from "@/lib/company";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatCentsToBrl } from "@/lib/money";
import { PRIORITY_LABELS, REASON_DESCRIPTIONS, SIGNAL_LABELS, STATUS_LABELS } from "@/lib/labels";
import { GenerateMessageButton, RegisterRevenueForm } from "./OpportunityActions";
import { markAsLostAction } from "@/lib/actions/opportunities";

const FACTOR_LABELS: Record<string, string> = {
  intencao: "Intenção demonstrada",
  recencia: "Recência",
  ticket: "Ticket",
  estagio: "Estágio da negociação",
  objecao: "Objeção",
  interacoes: "Quantidade de interações",
  sem_followup: "Ausência de follow-up",
};

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company } = await getCurrentCompany();
  const supabase = await createServerSupabase();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(
      "id, potential_value_cents, priority, status, probable_reason, recovery_score, next_action_text, score_breakdown_json, last_interaction_at, contacts(full_name, phone)",
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!opportunity) notFound();

  const [{ data: signals }, { data: latestMessage }] = await Promise.all([
    supabase.from("opportunity_signals").select("signal_type, confidence").eq("opportunity_id", id),
    supabase
      .from("recovery_messages")
      .select("generated_text, created_at")
      .eq("opportunity_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const contact = opportunity.contacts as unknown as { full_name: string; phone: string | null } | null;
  const breakdown = (opportunity.score_breakdown_json ?? {}) as Record<string, number>;
  const isActive = ["recuperavel", "quente", "morno", "frio"].includes(opportunity.status);

  return (
    <AppShell companyName={company.name} activePath="/oportunidades">
      <Link href="/oportunidades" className="mb-4 inline-block text-sm text-text-muted hover:text-text">
        ← Voltar ao radar
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{contact?.full_name ?? "Contato"}</h1>
          {contact?.phone && <p className="text-sm text-text-muted">{contact.phone}</p>}
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-bold tabular text-accent">
            {formatCentsToBrl(opportunity.potential_value_cents)}
          </p>
          <p className="text-xs text-text-muted">{STATUS_LABELS[opportunity.status]}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Motivo</h2>
            <p className="text-sm">
              {opportunity.probable_reason
                ? REASON_DESCRIPTIONS[opportunity.probable_reason]
                : "Ainda não classificado — dados insuficientes para uma classificação confiável."}
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Sinais identificados
            </h2>
            {signals && signals.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {signals.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    {SIGNAL_LABELS[s.signal_type]}
                    <span className="text-xs text-text-muted">({s.confidence})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">Nenhum sinal identificado ainda.</p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Próxima ação recomendada
            </h2>
            <p className="mb-4 text-sm">{opportunity.next_action_text ?? "Aguardando classificação."}</p>
            <GenerateMessageButton opportunityId={opportunity.id} hasMessage={Boolean(latestMessage)} />
            {latestMessage && (
              <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft p-4 text-sm">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-accent">
                  Mensagem gerada
                </p>
                <p className="whitespace-pre-wrap">{latestMessage.generated_text}</p>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
              Prioridade
            </h2>
            {opportunity.priority ? (
              <PriorityBadge priority={opportunity.priority} label={PRIORITY_LABELS[opportunity.priority]} />
            ) : (
              <p className="text-sm text-text-muted">Dados insuficientes para calcular prioridade.</p>
            )}
            {opportunity.recovery_score !== null && (
              <>
                <p className="mt-3 font-mono text-2xl font-bold tabular">{opportunity.recovery_score}/100</p>
                <p className="mb-2 text-xs text-text-muted">Recovery Score — regras transparentes, não uma previsão estatística.</p>
                <ul className="flex flex-col gap-1 text-xs text-text-muted">
                  {Object.entries(breakdown).map(([factor, points]) => (
                    <li key={factor} className="flex justify-between">
                      <span>{FACTOR_LABELS[factor] ?? factor}</span>
                      <span className="font-mono tabular">{points}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {isActive && (
            <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Ações</h2>
              <RegisterRevenueForm opportunityId={opportunity.id} />
              <form action={markAsLostAction}>
                <input type="hidden" name="opportunity_id" value={opportunity.id} />
                <button type="submit" className="text-sm text-text-muted underline hover:text-danger">
                  Marcar como perdido
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
