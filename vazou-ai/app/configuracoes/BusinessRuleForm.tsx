"use client";

import { useActionState } from "react";
import { addBusinessRule, type BusinessRuleState } from "@/lib/actions/businessRules";

const RULE_TYPE_OPTIONS = [
  { value: "max_discount_pct", label: "Desconto máximo" },
  { value: "payment_terms", label: "Condições de parcelamento" },
  { value: "business_hours", label: "Horário de atendimento" },
  { value: "brand_voice", label: "Tom de voz da marca" },
  { value: "no_promise_policy", label: "Política de não-promessa" },
  { value: "custom", label: "Outra" },
];

const inputClass =
  "rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-text outline-none transition focus:border-accent";

export function BusinessRuleForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState<BusinessRuleState, FormData>(addBusinessRule, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <input type="hidden" name="company_id" value={companyId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-muted">Tipo</span>
          <select name="rule_type" defaultValue="payment_terms" className={inputClass}>
            {RULE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-muted">Descrição (é exatamente o que a IA pode citar)</span>
          <input name="description" required placeholder="Ex: até 6x sem juros no cartão" className={inputClass} />
        </label>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Adicionar regra"}
      </button>
    </form>
  );
}
