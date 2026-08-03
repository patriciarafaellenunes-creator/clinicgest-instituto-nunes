// src/services/clinicalExamsService.js
//
// Mesmo padrão de imutabilidade dos outros módulos do prontuário: corrigir
// um achado ou diagnóstico cria uma nova versão encadeada, nunca edita o
// registro original. O diferencial deste module é a vinculação — um exame
// pode apontar para um dente/região E para um item específico do plano de
// tratamento, fechando o ciclo achado -> hipótese -> diagnóstico -> decisão
// de tratamento.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_EXAM_TYPES = [
  'clinico_intraoral', 'clinico_extraoral', 'oclusal', 'estetico', 'facial',
  'radiografia', 'tomografia', 'laboratorial', 'fotografia',
];

async function registerExam(client, {
  clinicId, patientId, professionalId, examType, toothOrRegion, treatmentPlanItemId,
  findings, diagnosticHypothesis, definitiveDiagnosis, fileReference, examDate, userId,
}) {
  if (!VALID_EXAM_TYPES.includes(examType)) throw new DomainError(`Tipo de exame inválido: ${examType}`, 'INVALID_EXAM_TYPE');
  if (!examDate) throw new DomainError('Data do exame é obrigatória.', 'MISSING_DATE');

  const { rows } = await client.query(
    `INSERT INTO clinical_exams
      (clinic_id, patient_id, professional_id, exam_type, tooth_or_region, treatment_plan_item_id,
       findings, diagnostic_hypothesis, definitive_diagnosis, file_reference, exam_date, version, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,true,$12)
     RETURNING *`,
    [clinicId, patientId, professionalId, examType, toothOrRegion || null, treatmentPlanItemId || null,
     findings || null, diagnosticHypothesis || null, definitiveDiagnosis || null, fileReference || null, examDate, userId]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'clinical_exams', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

/** Corrige um exame (achado ou diagnóstico): cria uma nova versão encadeada, nunca edita a original. */
async function correctExam(client, { examId, clinicId, userId, ...updatedFields }) {
  const { rows: originalRows } = await client.query(`SELECT * FROM clinical_exams WHERE id = $1 AND clinic_id = $2`, [examId, clinicId]);
  const original = originalRows[0];
  if (!original) throw new DomainError('Exame não encontrado.', 'NOT_FOUND');
  if (!original.is_current) {
    throw new DomainError('Este exame já foi substituído por uma versão mais recente. Corrija a versão atual.', 'NOT_CURRENT_VERSION');
  }

  const merged = {
    findings: updatedFields.findings ?? original.findings,
    diagnosticHypothesis: updatedFields.diagnosticHypothesis ?? original.diagnostic_hypothesis,
    definitiveDiagnosis: updatedFields.definitiveDiagnosis ?? original.definitive_diagnosis,
    fileReference: updatedFields.fileReference ?? original.file_reference,
    toothOrRegion: updatedFields.toothOrRegion ?? original.tooth_or_region,
  };

  const { rows } = await client.query(
    `INSERT INTO clinical_exams
      (clinic_id, patient_id, professional_id, exam_type, tooth_or_region, treatment_plan_item_id,
       findings, diagnostic_hypothesis, definitive_diagnosis, file_reference, exam_date, version, supersedes_id, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14)
     RETURNING *`,
    [original.clinic_id, original.patient_id, original.professional_id, original.exam_type, merged.toothOrRegion,
     original.treatment_plan_item_id, merged.findings, merged.diagnosticHypothesis, merged.definitiveDiagnosis,
     merged.fileReference, original.exam_date, original.version + 1, original.id, userId]
  );
  const corrected = rows[0];

  await client.query(`UPDATE clinical_exams SET is_current = false WHERE id = $1`, [original.id]);

  await logAudit(client, {
    clinicId, userId, tableName: 'clinical_exams', recordId: corrected.id, action: 'correction',
    beforeValue: original, afterValue: corrected,
  });

  return corrected;
}

async function getPatientExams(client, clinicId, patientId, { examType } = {}) {
  const params = [clinicId, patientId];
  let filter = '';
  if (examType) {
    params.push(examType);
    filter = ` AND exam_type = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT * FROM clinical_exams WHERE clinic_id = $1 AND patient_id = $2 AND is_current = true${filter} ORDER BY exam_date DESC`,
    params
  );
  return rows;
}

module.exports = { DomainError, VALID_EXAM_TYPES, registerExam, correctExam, getPatientExams };
