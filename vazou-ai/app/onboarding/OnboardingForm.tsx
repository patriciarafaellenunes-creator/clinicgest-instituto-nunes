"use client";

import { useActionState } from "react";
import { createCompany, type OnboardingState } from "@/lib/actions/onboarding";

const SEGMENTS: Array<{ value: string; label: string }> = [
  { value: "clinica", label: "Clínica" },
  { value: "odontologia", label: "Odontologia" },
  { value: "estetica", label: "Estética" },
  { value: "imobiliaria", label: "Imobiliária" },
  { value: "academia", label: "Academia" },
  { value: "escola", label: "Escola" },
  { value: "servicos_profissionais", label: "Serviços profissionais" },
  { value: "outro", label: "Outro" },
];

const inputClass =
  "rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-text outline-none transition focus:border-accent";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(createCompany, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-text-muted">Nome da empresa</span>
        <input name="name" required placeholder="Clínica Bella Saúde" className={inputClass} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-text-muted">Segmento</span>
        <select name="segment" defaultValue="clinica" className={inputClass}>
          {SEGMENTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-muted">Moeda</span>
          <input name="currency" defaultValue="BRL" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-muted">Fuso horário</span>
          <input name="timezone" defaultValue="America/Sao_Paulo" className={inputClass} />
        </label>
      </div>

      <div className="rounded-lg border border-border bg-surface-2/50 p-4">
        <p className="mb-3 text-sm font-medium text-text">
          Regras comerciais <span className="text-text-muted">(opcional — pode preencher depois)</span>
        </p>
        <p className="mb-3 text-xs text-text-muted">
          O que a IA pode usar ao gerar mensagens de recuperação. Ela nunca vai além disto.
        </p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Desconto máximo autorizado (%)</span>
            <input name="max_discount_pct" type="number" min="0" max="100" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Condições de parcelamento padrão</span>
            <input
              name="payment_terms"
              placeholder="Ex: até 6x sem juros no cartão"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Tom de voz da marca</span>
            <input
              name="brand_voice"
              placeholder="Ex: cordial, direto, sem gírias"
              className={inputClass}
            />
          </label>
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Criando..." : "Criar empresa e continuar"}
      </button>
    </form>
  );
}
