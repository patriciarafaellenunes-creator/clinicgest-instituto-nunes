// src/services/patientFilesService.js
//
// Metadados de arquivos do paciente — o arquivo em si (foto, radiografia,
// vídeo) fica em object storage, fora do escopo deste MVP (ver arquitetura
// no plano mestre). O que este service garante é a regra de segurança do
// documento 3: NUNCA existe exclusão física. A única forma de "remover" um
// arquivo é a exclusão lógica, com motivo — o registro nunca some do banco.
// Também rastreia autorização de uso de imagem por arquivo, porque a
// automação do documento 3 depende disso ("ao registrar fotografias,
// verificar autorização de uso de imagem").

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_CATEGORIES = [
  'fotografia_clinica', 'fotografia_facial', 'fotografia_intraoral', 'radiografia',
  'tomografia', 'escaneamento', 'video', 'audio', 'laudo', 'exame_laboratorial', 'documento',
];

const IMAGE_CATEGORIES = ['fotografia_clinica', 'fotografia_facial', 'fotografia_intraoral', 'video'];

async function registerFile(client, {
  clinicId, patientId, professionalId, category, relatedProcedureId, relatedExamId,
  fileReference, description, imageUsageAuthorized, userId,
}) {
  if (!VALID_CATEGORIES.includes(category)) throw new DomainError(`Categoria de arquivo inválida: ${category}`, 'INVALID_CATEGORY');
  if (!fileReference || !fileReference.trim()) throw new DomainError('Referência do arquivo é obrigatória.', 'MISSING_FILE_REFERENCE');

  const { rows } = await client.query(
    `INSERT INTO patient_files
      (clinic_id, patient_id, professional_id, category, related_procedure_id, related_exam_id,
       file_reference, description, image_usage_authorized, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [clinicId, patientId, professionalId || null, category, relatedProcedureId || null, relatedExamId || null,
     fileReference.trim(), description || null, !!imageUsageAuthorized, userId]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'patient_files', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

/** Exclusão lógica — o único jeito de "remover" um arquivo. O registro nunca é apagado do banco. */
async function logicallyDeleteFile(client, { id, clinicId, userId, reason }) {
  if (!reason || !reason.trim()) throw new DomainError('Motivo da exclusão é obrigatório.', 'REASON_REQUIRED');

  const { rows: beforeRows } = await client.query(`SELECT * FROM patient_files WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Arquivo não encontrado.', 'NOT_FOUND');
  if (before.is_deleted) throw new DomainError('Arquivo já está excluído (logicamente).', 'ALREADY_DELETED');

  const { rows } = await client.query(
    `UPDATE patient_files SET is_deleted = true, deleted_reason = $1, deleted_by = $2, deleted_at = now()
     WHERE id = $3 RETURNING *`,
    [reason.trim(), userId, id]
  );

  await logAudit(client, { clinicId, userId, tableName: 'patient_files', recordId: id, action: 'logical_delete', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

async function setImageUsageAuthorization(client, { id, clinicId, userId, authorized }) {
  const { rows: beforeRows } = await client.query(`SELECT * FROM patient_files WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Arquivo não encontrado.', 'NOT_FOUND');

  const { rows } = await client.query(
    `UPDATE patient_files SET image_usage_authorized = $1 WHERE id = $2 RETURNING *`,
    [!!authorized, id]
  );

  await logAudit(client, {
    clinicId, userId, tableName: 'patient_files', recordId: id, action: 'set_image_authorization',
    beforeValue: before, afterValue: rows[0],
  });
  return rows[0];
}

async function getPatientFiles(client, clinicId, patientId, { category, includeDeleted = false } = {}) {
  const params = [clinicId, patientId];
  let filter = includeDeleted ? '' : ' AND is_deleted = false';
  if (category) {
    params.push(category);
    filter += ` AND category = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT * FROM patient_files WHERE clinic_id = $1 AND patient_id = $2${filter} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

/** Fotos/vídeos ainda sem autorização de uso registrada — para a automação "verificar autorização antes de usar". */
async function getUnauthorizedImages(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT * FROM patient_files
     WHERE clinic_id = $1 AND patient_id = $2 AND is_deleted = false
       AND category = ANY($3) AND image_usage_authorized = false`,
    [clinicId, patientId, IMAGE_CATEGORIES]
  );
  return rows;
}

/** Mesma checagem, mas para a clínica inteira — usada pelo agente de IA documental ("quais pacientes não autorizaram uso de imagem?"). */
async function getUnauthorizedImagesClinicWide(client, clinicId) {
  const { rows } = await client.query(
    `SELECT pf.*, p.full_name AS patient_name FROM patient_files pf
     JOIN patients p ON p.id = pf.patient_id
     WHERE pf.clinic_id = $1 AND pf.is_deleted = false
       AND pf.category = ANY($2) AND pf.image_usage_authorized = false
     ORDER BY p.full_name`,
    [clinicId, IMAGE_CATEGORIES]
  );
  return rows;
}

module.exports = {
  DomainError, VALID_CATEGORIES, IMAGE_CATEGORIES,
  registerFile, logicallyDeleteFile, setImageUsageAuthorization, getPatientFiles, getUnauthorizedImages, getUnauthorizedImagesClinicWide,
};
