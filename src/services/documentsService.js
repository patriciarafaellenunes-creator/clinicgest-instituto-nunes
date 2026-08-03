// src/services/documentsService.js
//
// Núcleo genérico do documento 3: um "documento" serve pra contrato de
// paciente, termo, contrato de profissional, laboratório ou fornecedor —
// mesma máquina de status, versionamento e assinatura para todos os tipos,
// em vez de reimplementar isso 4 vezes.
//
// Regra de segurança central (seção 10 e 12 do documento 3): depois que
// TODAS as assinaturas exigidas foram coletadas, o documento vira imutável
// — nenhuma função de edição aceita mais alterações nele. Para corrigir ou
// renovar um documento já assinado, o caminho é criar uma nova versão
// (reviseDocument), que aponta pra anterior e a substitui, sem apagar nada.

const { logAudit } = require('./auditService');
const crypto = require('crypto');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const PARTY_TYPES = ['patient', 'professional', 'supplier', 'lab'];
const LOCKED_STATUSES = ['assinado', 'vigente', 'proximo_vencimento', 'vencido', 'renovado', 'substituido', 'cancelado', 'arquivado'];

function generateValidationCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

async function createTemplate(client, { clinicId, name, category, bodyTemplate, requiredForProcedureId, requiredForSpecialty, clinicalContent, userId }) {
  if (!name || !bodyTemplate) throw new DomainError('Nome e corpo do modelo são obrigatórios.', 'MISSING_FIELDS');

  const { rows } = await client.query(
    `INSERT INTO document_templates (clinic_id, name, category, body_template, required_for_procedure_id, required_for_specialty, clinical_content, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [clinicId, name, category, bodyTemplate, requiredForProcedureId || null, requiredForSpecialty || null,
     clinicalContent ? JSON.stringify(clinicalContent) : null, userId]
  );
  const record = rows[0];
  await logAudit(client, { clinicId, userId, tableName: 'document_templates', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

/** Cria um documento e já registra os signatários exigidos (pendentes até assinarem). */
async function createDocument(client, {
  clinicId, unitId, templateId, category, partyType, patientId, professionalId, supplierId,
  relatedProcedureId, relatedTreatmentPlanId, relatedBudgetId, content, documentNumber,
  validFrom, validUntil, signers, userId,
}) {
  if (!PARTY_TYPES.includes(partyType)) throw new DomainError(`Tipo de parte inválido: ${partyType}`, 'INVALID_PARTY_TYPE');
  if (!content || !content.trim()) throw new DomainError('Conteúdo do documento é obrigatório.', 'MISSING_CONTENT');
  if (!signers || signers.length === 0) throw new DomainError('Documento precisa de ao menos um signatário.', 'MISSING_SIGNERS');

  const { rows } = await client.query(
    `INSERT INTO documents
      (clinic_id, unit_id, template_id, document_number, category, party_type, patient_id, professional_id,
       supplier_id, related_procedure_id, related_treatment_plan_id, related_budget_id, content, status,
       valid_from, valid_until, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'rascunho',$14,$15,$16)
     RETURNING *`,
    [clinicId, unitId || null, templateId || null, documentNumber || null, category, partyType,
     patientId || null, professionalId || null, supplierId || null, relatedProcedureId || null,
     relatedTreatmentPlanId || null, relatedBudgetId || null, content.trim(), validFrom || null, validUntil || null, userId]
  );
  const document = rows[0];

  for (const signer of signers) {
    await client.query(
      `INSERT INTO document_signatures (document_id, signer_name, signer_role, signer_document, signer_email, status)
       VALUES ($1,$2,$3,$4,$5,'pendente')`,
      [document.id, signer.signerName, signer.signerRole, signer.signerDocument || null, signer.signerEmail || null]
    );
  }

  await logAudit(client, { clinicId, userId, tableName: 'documents', recordId: document.id, action: 'insert', afterValue: document });
  return document;
}

/** Lista os documentos correntes da clínica, com o nome da parte envolvida — usado pela tela de Documentos. */
async function listDocuments(client, clinicId) {
  const { rows } = await client.query(
    `SELECT d.*,
            COALESCE(p.full_name, pr.full_name, s.legal_name) AS party_name,
            COALESCE(sig.pending_signatures, 0) AS pending_signatures
     FROM documents d
     LEFT JOIN patients p ON p.id = d.patient_id
     LEFT JOIN professionals pr ON pr.id = d.professional_id
     LEFT JOIN suppliers s ON s.id = d.supplier_id
     LEFT JOIN (
       SELECT document_id, COUNT(*)::int AS pending_signatures
       FROM document_signatures WHERE status = 'pendente' GROUP BY document_id
     ) sig ON sig.document_id = d.id
     WHERE d.clinic_id = $1 AND d.is_current = true
     ORDER BY d.created_at DESC`,
    [clinicId]
  );
  return rows;
}

async function getDocumentWithSignatures(client, clinicId, documentId) {
  const { rows: docRows } = await client.query(`SELECT * FROM documents WHERE id = $1 AND clinic_id = $2`, [documentId, clinicId]);
  const document = docRows[0];
  if (!document) throw new DomainError('Documento não encontrado.', 'NOT_FOUND');

  const { rows: signatures } = await client.query(`SELECT * FROM document_signatures WHERE document_id = $1 ORDER BY created_at`, [documentId]);
  return { ...document, signatures };
}

function assertNotLocked(document) {
  if (LOCKED_STATUSES.includes(document.status)) {
    throw new DomainError(
      `Documento no status "${document.status}" não pode mais ser editado — crie uma nova versão (revisão) se precisar alterar.`,
      'DOCUMENT_LOCKED'
    );
  }
}

async function updateDocumentStatus(client, { id, clinicId, userId, status }) {
  const allowedManualTransitions = ['em_revisao', 'aguardando_aprovacao', 'aguardando_assinatura', 'cancelado', 'arquivado'];
  if (!allowedManualTransitions.includes(status)) {
    throw new DomainError(`Transição manual de status inválida: ${status}`, 'INVALID_STATUS');
  }

  const document = await getDocumentWithSignatures(client, clinicId, id);
  if (status !== 'cancelado' && status !== 'arquivado') assertNotLocked(document);

  const { rows } = await client.query(`UPDATE documents SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
  await logAudit(client, { clinicId, userId, tableName: 'documents', recordId: id, action: 'update_status', beforeValue: document, afterValue: rows[0] });
  return rows[0];
}

/**
 * Registra a assinatura de UM signatário. Se, depois desta, todos os
 * signatários exigidos estiverem assinados, o documento vira "assinado"
 * automaticamente e fica travado para edição (assertNotLocked passa a
 * bloquear qualquer alteração de conteúdo dali em diante).
 */
async function recordSignature(client, { documentId, signatureId, clinicId, userId, signatureMethod, ipAddress, deviceInfo }) {
  const document = await getDocumentWithSignatures(client, clinicId, documentId);
  assertNotLocked(document);

  const signature = document.signatures.find((s) => s.id === signatureId);
  if (!signature) throw new DomainError('Signatário não encontrado neste documento.', 'SIGNATURE_NOT_FOUND');
  if (signature.status === 'assinado') throw new DomainError('Este signatário já assinou.', 'ALREADY_SIGNED');

  const validationCode = generateValidationCode();
  const { rows: updatedSigRows } = await client.query(
    `UPDATE document_signatures
     SET status = 'assinado', signed_at = now(), signature_method = $1, ip_address = $2, device_info = $3, validation_code = $4
     WHERE id = $5 RETURNING *`,
    [signatureMethod, ipAddress || null, deviceInfo || null, validationCode, signatureId]
  );

  const { rows: allSigsRows } = await client.query(`SELECT * FROM document_signatures WHERE document_id = $1`, [documentId]);
  const allSigned = allSigsRows.every((s) => s.status === 'assinado');
  const anySigned = allSigsRows.some((s) => s.status === 'assinado');

  const newDocStatus = allSigned ? 'assinado' : anySigned ? 'parcialmente_assinado' : document.status;
  const { rows: updatedDocRows } = await client.query(`UPDATE documents SET status = $1 WHERE id = $2 RETURNING *`, [newDocStatus, documentId]);

  await logAudit(client, {
    clinicId, userId, tableName: 'document_signatures', recordId: signatureId, action: 'sign',
    beforeValue: signature, afterValue: updatedSigRows[0],
  });
  if (allSigned) {
    await logAudit(client, { clinicId, userId, tableName: 'documents', recordId: documentId, action: 'fully_signed', afterValue: updatedDocRows[0] });
  }

  return { signature: updatedSigRows[0], document: updatedDocRows[0], fullySigned: allSigned };
}

/** Cria uma nova versão do documento (revisão ou renovação), encadeada à anterior, que é marcada como substituída. */
async function reviseDocument(client, { originalDocumentId, clinicId, userId, content, validFrom, validUntil, signers }) {
  const original = await getDocumentWithSignatures(client, clinicId, originalDocumentId);
  if (!original.is_current) throw new DomainError('Este documento já foi substituído por uma versão mais recente.', 'NOT_CURRENT_VERSION');

  const newDoc = await createDocument(client, {
    clinicId: original.clinic_id, unitId: original.unit_id, templateId: original.template_id,
    category: original.category, partyType: original.party_type, patientId: original.patient_id,
    professionalId: original.professional_id, supplierId: original.supplier_id,
    relatedProcedureId: original.related_procedure_id, relatedTreatmentPlanId: original.related_treatment_plan_id,
    relatedBudgetId: original.related_budget_id, content: content || original.content,
    validFrom: validFrom || original.valid_from, validUntil: validUntil || original.valid_until,
    signers: signers || original.signatures.map((s) => ({ signerName: s.signer_name, signerRole: s.signer_role, signerDocument: s.signer_document, signerEmail: s.signer_email })),
    userId,
  });

  await client.query(`UPDATE documents SET version = $1, supersedes_id = $2 WHERE id = $3`, [original.version + 1, original.id, newDoc.id]);
  await client.query(`UPDATE documents SET status = 'substituido', is_current = false WHERE id = $1`, [original.id]);

  const { rows: finalRows } = await client.query(`SELECT * FROM documents WHERE id = $1`, [newDoc.id]);

  await logAudit(client, { clinicId, userId, tableName: 'documents', recordId: newDoc.id, action: 'revision', beforeValue: original, afterValue: finalRows[0] });
  return finalRows[0];
}

// ---------------------------------------------------------------------------
// CONSULTAS (usadas por automações e pelo agente de IA documental)
// ---------------------------------------------------------------------------

async function getPendingSignatures(client, clinicId, { patientId } = {}) {
  const params = [clinicId];
  let filter = '';
  if (patientId) {
    params.push(patientId);
    filter = ` AND d.patient_id = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT d.id AS document_id, d.category, d.patient_id, p.full_name AS patient_name, ds.id AS signature_id, ds.signer_name, ds.signer_role
     FROM document_signatures ds
     JOIN documents d ON d.id = ds.document_id
     LEFT JOIN patients p ON p.id = d.patient_id
     WHERE d.clinic_id = $1 AND d.is_current = true AND ds.status = 'pendente'${filter}
     ORDER BY d.created_at DESC`,
    params
  );
  return rows;
}

async function getExpiringDocuments(client, clinicId, days = 30) {
  const { rows } = await client.query(
    `SELECT * FROM documents
     WHERE clinic_id = $1 AND is_current = true AND status NOT IN ('cancelado','substituido','arquivado')
       AND valid_until IS NOT NULL AND valid_until <= CURRENT_DATE + $2::int
     ORDER BY valid_until ASC`,
    [clinicId, days]
  );
  return rows;
}

/** Verifica se faltam documentos obrigatórios (assinados) para um procedimento — usado antes de liberar o atendimento. */
async function checkRequiredDocumentsForProcedure(client, clinicId, patientId, procedureId) {
  const { rows: procedureRows } = await client.query(`SELECT * FROM procedures WHERE id = $1 AND clinic_id = $2`, [procedureId, clinicId]);
  const procedure = procedureRows[0];

  const { rows: templates } = await client.query(
    `SELECT * FROM document_templates
     WHERE clinic_id = $1 AND is_active = true
       AND (required_for_procedure_id = $2 OR (required_for_specialty IS NOT NULL AND required_for_specialty = $3))`,
    [clinicId, procedureId, procedure ? procedure.specialty : null]
  );
  if (templates.length === 0) return { complete: true, missing: [] };

  const missing = [];
  for (const template of templates) {
    const { rows: signedDocs } = await client.query(
      `SELECT * FROM documents WHERE clinic_id = $1 AND patient_id = $2 AND template_id = $3 AND is_current = true AND status = 'assinado'`,
      [clinicId, patientId, template.id]
    );
    if (signedDocs.length === 0) missing.push({ templateId: template.id, templateName: template.name });
  }

  return { complete: missing.length === 0, missing };
}

async function getSuppliersWithoutActiveContract(client, clinicId, { category } = {}) {
  const params = [clinicId];
  let categoryFilter = '';
  if (category) {
    params.push(category);
    categoryFilter = ` AND d.category = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT s.* FROM suppliers s
     LEFT JOIN documents d
       ON d.supplier_id = s.id AND d.is_current = true AND d.status = 'assinado'${categoryFilter}
     WHERE s.clinic_id = $1 AND d.id IS NULL
     ORDER BY s.legal_name`,
    params
  );
  return rows;
}

/** Visão geral de quais procedimentos/especialidades exigem termo — para responder "quais procedimentos exigem consentimento específico?". */
async function getRequiredTemplatesOverview(client, clinicId) {
  const { rows } = await client.query(
    `SELECT dt.id, dt.name, dt.category, dt.required_for_specialty, p.name AS required_for_procedure_name
     FROM document_templates dt
     LEFT JOIN procedures p ON p.id = dt.required_for_procedure_id
     WHERE dt.clinic_id = $1 AND dt.is_active = true
       AND (dt.required_for_procedure_id IS NOT NULL OR dt.required_for_specialty IS NOT NULL)
     ORDER BY dt.name`,
    [clinicId]
  );
  return rows;
}

/** Agendamentos nos próximos N dias cujo paciente ainda não tem toda a documentação obrigatória assinada para o procedimento. */
async function getAppointmentsMissingDocuments(client, clinicId, days = 7) {
  const { rows: appointments } = await client.query(
    `SELECT a.id AS appointment_id, a.starts_at, a.patient_id, a.procedure_id, p.full_name AS patient_name, pr.name AS procedure_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN procedures pr ON pr.id = a.procedure_id
     WHERE a.clinic_id = $1 AND a.procedure_id IS NOT NULL
       AND a.status NOT IN ('cancelado', 'faltou', 'finalizado')
       AND a.starts_at BETWEEN now() AND now() + ($2 || ' days')::interval`,
    [clinicId, days]
  );

  const results = [];
  for (const appt of appointments) {
    const check = await checkRequiredDocumentsForProcedure(client, clinicId, appt.patient_id, appt.procedure_id);
    if (!check.complete) {
      results.push({ ...appt, missingDocuments: check.missing });
    }
  }
  return results;
}

module.exports = {
  DomainError, PARTY_TYPES, LOCKED_STATUSES,
  createTemplate, createDocument, listDocuments, getDocumentWithSignatures, updateDocumentStatus, recordSignature,
  reviseDocument, getPendingSignatures, getExpiringDocuments, checkRequiredDocumentsForProcedure,
  getSuppliersWithoutActiveContract, getRequiredTemplatesOverview, getAppointmentsMissingDocuments,
};
