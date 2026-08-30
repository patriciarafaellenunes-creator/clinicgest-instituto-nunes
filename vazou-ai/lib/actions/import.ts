"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { assertMembership } from "@/lib/supabase/membership";
import { processQueuedJobs } from "@/lib/ai/processJobs";
import { parseCsvWithHeader } from "@/lib/csv";
import { parseBrlToCents, parseFlexibleDateToIso } from "@/lib/money";

export interface ImportState {
  error: string | null;
  success: string | null;
}

interface ParsedRow {
  contactName: string;
  phone: string | null;
  channel: "whatsapp" | "manual" | "email" | "instagram";
  potentialValueCents: number | null;
  lastInteractionIso: string | null;
  conversationText: string;
}

export async function importCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const companyId = String(formData.get("company_id") ?? "");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo CSV.", success: null };
  }

  const text = await file.text();
  const records = parseCsvWithHeader(text);

  if (records.length === 0) {
    return { error: "O arquivo está vazio ou não pôde ser lido.", success: null };
  }

  const rows: ParsedRow[] = records
    .filter((r) => (r.nome_contato ?? r.nome ?? "").trim())
    .map((r) => ({
      contactName: (r.nome_contato ?? r.nome ?? "").trim(),
      phone: (r.telefone ?? "").trim() || null,
      channel: (["whatsapp", "manual", "email", "instagram"].includes(r.canal ?? "")
        ? (r.canal as ParsedRow["channel"])
        : "whatsapp"),
      potentialValueCents: parseBrlToCents(r.valor_orcamento),
      lastInteractionIso: parseFlexibleDateToIso(r.data_ultima_interacao),
      conversationText: (r.conversa ?? "").trim(),
    }))
    .filter((r) => r.conversationText.length > 0);

  if (rows.length === 0) {
    return {
      error:
        "Nenhuma linha válida encontrada. Confira as colunas: nome_contato, telefone, canal, valor_orcamento, data_ultima_interacao, conversa.",
      success: null,
    };
  }

  return runImportBatch(companyId, "csv_upload", file.name, rows);
}

export async function importManualPaste(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const companyId = String(formData.get("company_id") ?? "");
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const potentialValueCents = parseBrlToCents(String(formData.get("potential_value") ?? ""));
  const lastInteractionIso = parseFlexibleDateToIso(String(formData.get("last_interaction") ?? ""));
  const conversationText = String(formData.get("conversation") ?? "").trim();

  if (!contactName || !conversationText) {
    return { error: "Preencha o nome do contato e a conversa.", success: null };
  }

  const rows: ParsedRow[] = [
    { contactName, phone, channel: "manual", potentialValueCents, lastInteractionIso, conversationText },
  ];

  return runImportBatch(companyId, "manual_paste", null, rows);
}

async function runImportBatch(
  companyId: string,
  source: "csv_upload" | "manual_paste",
  filename: string | null,
  rows: ParsedRow[],
): Promise<ImportState> {
  try {
    const { userId } = await assertMembership(companyId);
    const supabase = await createServerSupabase();

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        company_id: companyId,
        source,
        filename,
        status: "processing",
        row_count: rows.length,
        created_by: userId,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      return { error: "Não foi possível iniciar a importação.", success: null };
    }

    for (const row of rows) {
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          company_id: companyId,
          full_name: row.contactName,
          phone: row.phone,
          source,
        })
        .select("id")
        .single();

      if (contactError || !contact) continue;

      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({
          company_id: companyId,
          contact_id: contact.id,
          import_batch_id: batch.id,
          channel: row.channel,
          last_message_at: row.lastInteractionIso,
        })
        .select("id")
        .single();

      if (conversationError || !conversation) continue;

      // MVP: a conversa colada/importada entra como uma única mensagem do
      // cliente. Granularidade por mensagem (com timestamps individuais) é
      // o que uma integração real de canal (WhatsApp, V1) vai popular sem
      // precisar mudar este schema — ver §2.2 do PRD.
      await supabase.from("messages").insert({
        conversation_id: conversation.id,
        company_id: companyId,
        sender: "contact",
        content_text: row.conversationText,
        sent_at: row.lastInteractionIso ?? new Date().toISOString(),
        sequence_index: 0,
      });

      if (row.potentialValueCents !== null) {
        await supabase.from("opportunities").insert({
          company_id: companyId,
          contact_id: contact.id,
          conversation_id: conversation.id,
          potential_value_cents: row.potentialValueCents,
          status: "recuperavel",
          last_interaction_at: row.lastInteractionIso,
        });
      }

      await supabase.from("ai_processing_jobs").insert({
        company_id: companyId,
        conversation_id: conversation.id,
        job_type: "classify",
        status: "queued",
      });
    }

    await supabase.from("import_batches").update({ status: "processing" }).eq("id", batch.id);

    const result = await processQueuedJobs(supabase, companyId, rows.length + 10);

    await supabase
      .from("import_batches")
      .update({
        status: result.failed > 0 && result.processed === 0 ? "failed" : "completed",
      })
      .eq("id", batch.id);

    revalidatePath("/dashboard");
    revalidatePath("/oportunidades");

    return {
      error: null,
      success: `Importação concluída: ${result.processed} conversa(s) processada(s)${
        result.failed > 0 ? `, ${result.failed} com erro (marcadas para revisão)` : ""
      }.`,
    };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_A_MEMBER") {
      return { error: "Você não tem acesso a esta empresa.", success: null };
    }
    return {
      error: `Erro inesperado na importação: ${err instanceof Error ? err.message : "desconhecido"}`,
      success: null,
    };
  }
}
