import { AppShell } from "@/components/AppShell";
import { getCurrentCompany } from "@/lib/company";
import { createServerSupabase } from "@/lib/supabase/server";
import { toggleBusinessRule } from "@/lib/actions/businessRules";
import { BusinessRuleForm } from "./BusinessRuleForm";

export default async function ConfiguracoesPage() {
  const { company } = await getCurrentCompany();
  const supabase = await createServerSupabase();

  const { data: rules } = await supabase
    .from("business_rules")
    .select("id, rule_type, description, active, created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  return (
    <AppShell companyName={company.name} activePath="/configuracoes">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Configurações</h1>
      <p className="mb-8 max-w-xl text-sm text-text-muted">
        Empresa: <strong>{company.name}</strong> · Segmento: {company.segment} · Moeda: {company.currency}
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Regras comerciais
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-text-muted">
          O que a IA tem permissão de usar ao gerar mensagens de recuperação. Ela nunca cria desconto,
          prazo ou condição que não esteja aqui ou na própria conversa.
        </p>

        <div className="mb-4 flex flex-col gap-2">
          {rules && rules.length > 0 ? (
            rules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
                  rule.active ? "border-border bg-surface" : "border-border bg-surface-2/40 opacity-60"
                }`}
              >
                <div>
                  <p className="text-sm">{rule.description}</p>
                  <p className="text-xs text-text-muted">{rule.rule_type}</p>
                </div>
                <form action={toggleBusinessRule}>
                  <input type="hidden" name="rule_id" value={rule.id} />
                  <input type="hidden" name="active" value={String(rule.active)} />
                  <button type="submit" className="text-xs text-text-muted underline hover:text-text">
                    {rule.active ? "Desativar" : "Reativar"}
                  </button>
                </form>
              </div>
            ))
          ) : (
            <p className="text-sm text-text-muted">Nenhuma regra cadastrada ainda.</p>
          )}
        </div>

        <BusinessRuleForm companyId={company.id} />
      </section>
    </AppShell>
  );
}
