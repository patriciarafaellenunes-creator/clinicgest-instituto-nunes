"use client";

import { useActionState, useState } from "react";
import {
  generateMessageAction,
  registerRecoveredRevenueAction,
  type OpportunityActionState,
} from "@/lib/actions/opportunities";

const initialState: OpportunityActionState = { error: null, success: null };
const inputClass =
  "rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-text outline-none transition focus:border-accent";

export function GenerateMessageButton({
  opportunityId,
  hasMessage,
}: {
  opportunityId: string;
  hasMessage: boolean;
}) {
  const [state, formAction, pending] = useActionState(generateMessageAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Gerando..." : hasMessage ? "Gerar nova abordagem" : "Gerar abordagem"}
      </button>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function RegisterRevenueForm({ opportunityId }: { opportunityId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(registerRecoveredRevenueAction, initialState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent hover:opacity-90"
      >
        Registrar receita recuperada
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/60 p-4">
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-text-muted">Valor recebido</span>
        <input name="amount" required placeholder="3.500,00" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-text-muted">Observações (opcional)</span>
        <input name="notes" className={inputClass} />
      </label>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.success && <p className="text-sm text-accent">{state.success}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Registrando..." : "Confirmar"}
      </button>
    </form>
  );
}
