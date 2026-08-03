// src/services/periodontalService.js
//
// Cada exame periodontal é uma "foto" completa de uma visita — profundidade
// de sondagem, sangramento, recessão, mobilidade, furca, placa e supuração
// por dente/face. Mesma regra de imutabilidade dos outros módulos do
// prontuário: corrigir um exame não edita as medições já lançadas, cria um
// exame novo (com suas próprias medições) encadeado ao anterior.
//
// O valor clínico real deste módulo é a COMPARAÇÃO entre exames ao longo do
// tempo — é o que mostra se a doença periodontal está progredindo ou
// regredindo, sítio por sítio ("gráficos de evolução periodontal" no
// briefing). compareExams() é a função que sustenta isso.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_SITES = ['mesio_vestibular', 'vestibular', 'disto_vestibular', 'mesio_lingual', 'lingual', 'disto_lingual'];

function computeAttachmentLevel(measurement) {
  if (measurement.probing_depth == null || measurement.recession == null) return null;
  return Number(measurement.probing_depth) + Number(measurement.recession);
}

async function createPeriodontalExam(client, { clinicId, patientId, professionalId, appointmentId, examDate, measurements, userId }) {
  if (!measurements || measurements.length === 0) {
    throw new DomainError('Exame periodontal precisa de ao menos uma medição.', 'EMPTY_EXAM');
  }
  for (const m of measurements) {
    if (!m.toothNumber) throw new DomainError('Toda medição precisa do número do dente.', 'MISSING_TOOTH');
    if (!VALID_SITES.includes(m.site)) throw new DomainError(`Sítio de medição inválido: ${m.site}`, 'INVALID_SITE');
  }

  const { rows } = await client.query(
    `INSERT INTO periodontal_exams (clinic_id, patient_id, professional_id, appointment_id, exam_date, version, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,1,true,$6) RETURNING *`,
    [clinicId, patientId, professionalId, appointmentId || null, examDate, userId]
  );
  const exam = rows[0];

  for (const m of measurements) {
    await client.query(
      `INSERT INTO periodontal_measurements
        (exam_id, tooth_number, site, probing_depth, bleeding, recession, mobility, furcation, plaque, suppuration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [exam.id, m.toothNumber, m.site, m.probingDepth ?? null, !!m.bleeding, m.recession ?? 0,
       m.mobility ?? 0, m.furcation ?? 0, !!m.plaque, !!m.suppuration]
    );
  }

  await logAudit(client, { clinicId, userId, tableName: 'periodontal_exams', recordId: exam.id, action: 'insert', afterValue: exam });
  return exam;
}

/** Corrige um exame inteiro: cria um novo exame (com novas medições) encadeado ao original, que permanece intacto. */
async function correctPeriodontalExam(client, { examId, clinicId, userId, measurements, examDate }) {
  const { rows: originalRows } = await client.query(`SELECT * FROM periodontal_exams WHERE id = $1 AND clinic_id = $2`, [examId, clinicId]);
  const original = originalRows[0];
  if (!original) throw new DomainError('Exame periodontal não encontrado.', 'NOT_FOUND');
  if (!original.is_current) {
    throw new DomainError('Este exame já foi substituído por uma versão mais recente. Corrija a versão atual.', 'NOT_CURRENT_VERSION');
  }

  const newExam = await createPeriodontalExam(client, {
    clinicId: original.clinic_id, patientId: original.patient_id, professionalId: original.professional_id,
    appointmentId: original.appointment_id, examDate: examDate || original.exam_date, measurements, userId,
  });

  await client.query(
    `UPDATE periodontal_exams SET version = $1, supersedes_id = $2 WHERE id = $3`,
    [original.version + 1, original.id, newExam.id]
  );
  await client.query(`UPDATE periodontal_exams SET is_current = false WHERE id = $1`, [original.id]);

  const { rows: finalRows } = await client.query(`SELECT * FROM periodontal_exams WHERE id = $1`, [newExam.id]);

  await logAudit(client, {
    clinicId, userId, tableName: 'periodontal_exams', recordId: newExam.id, action: 'correction',
    beforeValue: original, afterValue: finalRows[0],
  });

  return finalRows[0];
}

async function getExamWithMeasurements(client, clinicId, examId) {
  const { rows: examRows } = await client.query(`SELECT * FROM periodontal_exams WHERE id = $1 AND clinic_id = $2`, [examId, clinicId]);
  const exam = examRows[0];
  if (!exam) throw new DomainError('Exame periodontal não encontrado.', 'NOT_FOUND');

  const { rows: measurements } = await client.query(`SELECT * FROM periodontal_measurements WHERE exam_id = $1 ORDER BY tooth_number, site`, [examId]);
  const withCal = measurements.map((m) => ({ ...m, clinical_attachment_level: computeAttachmentLevel(m) }));

  const bleedingSites = measurements.filter((m) => m.bleeding).length;
  const plaqueSites = measurements.filter((m) => m.plaque).length;

  return {
    ...exam,
    measurements: withCal,
    summary: {
      totalSites: measurements.length,
      bleedingIndex: measurements.length > 0 ? bleedingSites / measurements.length : 0,
      plaqueIndex: measurements.length > 0 ? plaqueSites / measurements.length : 0,
      deepSites: measurements.filter((m) => m.probing_depth != null && m.probing_depth >= 4).length,
    },
  };
}

async function getPatientExamHistory(client, clinicId, patientId) {
  const { rows: exams } = await client.query(
    `SELECT * FROM periodontal_exams WHERE clinic_id = $1 AND patient_id = $2 AND is_current = true ORDER BY exam_date DESC`,
    [clinicId, patientId]
  );
  return Promise.all(exams.map((e) => getExamWithMeasurements(client, clinicId, e.id)));
}

/** Compara duas medições de exames (mesmo dente/site) e aponta progressão ou regressão sítio a sítio. */
async function compareExams(client, clinicId, examIdBefore, examIdAfter) {
  const [before, after] = await Promise.all([
    getExamWithMeasurements(client, clinicId, examIdBefore),
    getExamWithMeasurements(client, clinicId, examIdAfter),
  ]);

  const siteKey = (m) => `${m.tooth_number}|${m.site}`;
  const beforeMap = new Map(before.measurements.map((m) => [siteKey(m), m]));

  const changes = [];
  for (const afterM of after.measurements) {
    const beforeM = beforeMap.get(siteKey(afterM));
    if (!beforeM || beforeM.probing_depth == null || afterM.probing_depth == null) continue;

    const delta = afterM.probing_depth - beforeM.probing_depth;
    if (delta !== 0 || beforeM.bleeding !== afterM.bleeding) {
      changes.push({
        toothNumber: afterM.tooth_number,
        site: afterM.site,
        probingDepthBefore: beforeM.probing_depth,
        probingDepthAfter: afterM.probing_depth,
        delta,
        trend: delta > 0 ? 'progressao' : delta < 0 ? 'regressao' : 'estavel',
        bleedingBefore: beforeM.bleeding,
        bleedingAfter: afterM.bleeding,
      });
    }
  }

  return {
    examBefore: { id: before.id, examDate: before.exam_date, bleedingIndex: before.summary.bleedingIndex },
    examAfter: { id: after.id, examDate: after.exam_date, bleedingIndex: after.summary.bleedingIndex },
    siteChanges: changes,
  };
}

module.exports = {
  DomainError, VALID_SITES,
  createPeriodontalExam, correctPeriodontalExam, getExamWithMeasurements, getPatientExamHistory, compareExams,
};
