"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions/auth";

interface Field {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  required?: boolean;
}

export function AuthForm({
  action,
  fields,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Field[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-muted">{field.label}</span>
          <input
            name={field.name}
            type={field.type}
            placeholder={field.placeholder}
            required={field.required ?? true}
            className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-text outline-none transition focus:border-accent"
          />
        </label>
      ))}

      {state.error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Enviando..." : submitLabel}
      </button>
    </form>
  );
}
