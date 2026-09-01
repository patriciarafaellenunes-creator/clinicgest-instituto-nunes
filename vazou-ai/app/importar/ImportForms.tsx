"use client";

import { useActionState, useState } from "react";
import { importCsv, importManualPaste, type ImportState } from "@/lib/actions/import";

const inputClass =
  "rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-text outline-none transition focus:border-accent";

const CSV_TEMPLATE =
  "nome_contato,telefone,canal,valor_orcamento,data_ultima_interacao,conversa\n" +
  'Mariana Lopes,11999990000,whatsapp,"3.500,00",26/08/2026,"Cliente: Oi! Vocês enviaram o orçamento do tratamento premium?\nAtendente: Oi Mariana! Enviei sim, R$ 3.500 em até 6x.\nCliente: Consigo parcelar em mais vezes?"\n';

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vazou-ai-modelo-importacao.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const initialState: ImportState = { error: null, success: null };

export function ImportForms({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<"csv" | "manual">("csv");
  const [csvState, csvAction, csvPending] = useActionState(importCsv, initialState);
  const [manualState, manualAction, manualPending] = useActionState(importManualPaste, initialState);

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <TabButton active={tab === "csv"} onClick={() => setTab("csv")}>
          Importar CSV
        </TabButton>
        <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
          Colar conversa
        </TabButton>
      </div>

      {tab === "csv" && (
        <form action={csvAction} className="flex max-w-xl flex-col gap-4">
          <input type="hidden" name="company_id" value={companyId} />

          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="mb-2 text-sm font-medium">Colunas esperadas</p>
            <code className="block overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">
              nome_contato, telefone, canal, valor_orcamento, data_ultima_interacao, conversa
            </code>
            <button
              type="button"
              onClick={downloadTemplate}
              className="mt-3 text-xs font-medium text-accent hover:underline"
            >
              Baixar modelo de exemplo
            </button>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Arquivo CSV</span>
            <input type="file" name="file" accept=".csv,text/csv" required className={inputClass} />
          </label>

          <Feedback state={csvState} />

          <button
            type="submit"
            disabled={csvPending}
            className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
          >
            {csvPending ? "Processando..." : "Importar e analisar"}
          </button>
        </form>
      )}

      {tab === "manual" && (
        <form action={manualAction} className="flex max-w-xl flex-col gap-4">
          <input type="hidden" name="company_id" value={companyId} />

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Nome do contato</span>
            <input name="contact_name" required className={inputClass} />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-muted">Telefone (opcional)</span>
              <input name="phone" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-muted">Valor do orçamento (opcional)</span>
              <input name="potential_value" placeholder="3.500,00" className={inputClass} />
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Data da última interação (opcional)</span>
            <input name="last_interaction" placeholder="DD/MM/AAAA" className={inputClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-text-muted">Conversa</span>
            <textarea
              name="conversation"
              required
              rows={8}
              placeholder={"Cliente: Oi, ainda dá pra fazer o tratamento?\nAtendente: Dá sim! ..."}
              className={inputClass}
            />
          </label>

          <Feedback state={manualState} />

          <button
            type="submit"
            disabled={manualPending}
            className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-60"
          >
            {manualPending ? "Processando..." : "Analisar conversa"}
          </button>
        </form>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? "bg-accent text-bg" : "bg-surface-2 text-text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Feedback({ state }: { state: ImportState }) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-lg border border-accent/30 bg-accent-soft px-3.5 py-2.5 text-sm text-accent">
        {state.success}
      </p>
    );
  }
  return null;
}
