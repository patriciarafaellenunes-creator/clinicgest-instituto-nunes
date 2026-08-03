// src/services/clinicalRecordsService.js
//
// Regra central (seção "Segurança clínica e jurídica" do documento 2):
// prontuário é cronológico e nada se apaga ou se sobrescreve silenciosamente.
//   - Anamnese: cada atualização cria uma nova versão; a anterior vira
//     histórico (is_current = false), nunca é editada nem some.
//   - Evolução clínica: é escrita uma vez. Uma "correção" não edita a linha
//     original — cria uma nova linha apontando pra ela (supersedes_id), e a
//     original fica marcada como não-atual, mas permanece intacta e visível
//     na auditoria. Isso é decisão de design, não só política: mesmo que
//     alguém tente, não existe um caminho de código que edite uma evolução
//     já criada.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// ANAMNESE
// ---------------------------------------------------------------------------

/** Cria uma nova versão da anamnese. Se já existir uma atual, ela é preservada e apenas marcada como não-atual. */
async function createAnamnesisVersion(client, {
  clinicId, patientId, userId, chiefComplaint, medicalHistory, riskClassification,
  clinicalAlerts, signedByPatient, signedByProfessionalId,
}) {
  const { rows: currentRows } = await client.query(
    `SELECT * FROM clinical_anamnesis WHERE patient_id = $1 AND is_current = true`,
    [patientId]
  );
  const current = currentRows[0];
  const nextVersion = current ? current.version + 1 : 1;

  const { rows } = await client.query(
    `INSERT INTO clinical_anamnesis
      (clinic_id, patient_id, version, previous_version_id, is_current, chief_complaint, medical_history,
       risk_classification, clinical_alerts, signed_by_patient, signed_by_professional_id, created_by)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [clinicId, patientId, nextVersion, current ? current.id : null, chiefComplaint || null,
     medicalHistory ? JSON.stringify(medicalHistory) : null, riskClassification || null,
     clinicalAlerts || null, !!signedByPatient, signedByProfessionalId || null, userId]
  );
  const record = rows[0];

  if (current) {
    await client.query(`UPDATE clinical_anamnesis SET is_current = false WHERE id = $1`, [current.id]);
  }

  await logAudit(client, {
    clinicId, userId, tableName: 'clinical_anamnesis', recordId: record.id, action: 'insert_version',
    beforeValue: current || null, afterValue: record,
  });

  return record;
}

async function getCurrentAnamnesis(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT * FROM clinical_anamnesis WHERE clinic_id = $1 AND patient_id = $2 AND is_current = true`,
    [clinicId, patientId]
  );
  return rows[0] || null;
}

async function getAnamnesisHistory(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT * FROM clinical_anamnesis WHERE clinic_id = $1 AND patient_id = $2 ORDER BY version DESC`,
    [clinicId, patientId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// EVOLUÇÃO CLÍNICA
// ---------------------------------------------------------------------------

async function addClinicalEvolution(client, {
  clinicId, patientId, appointmentId, professionalId, procedureId, toothOrRegion, description,
  materialsUsed, medicationsAdministered, anestheticUsed, complications, patientInstructions,
  nextStep, returnRecommendedDays, userId,
}) {
  if (!description || !description.trim()) {
    throw new DomainError('Descrição da evolução é obrigatória.', 'MISSING_DESCRIPTION');
  }

  const { rows } = await client.query(
    `INSERT INTO clinical_evolutions
      (clinic_id, patient_id, appointment_id, professional_id, procedure_id, tooth_or_region, description,
       materials_used, medications_administered, anesthetic_used, complications, patient_instructions,
       next_step, return_recommended_days, version, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,true,$15)
     RETURNING *`,
    [clinicId, patientId, appointmentId || null, professionalId, procedureId || null, toothOrRegion || null,
     description.trim(), materialsUsed || null, medicationsAdministered || null, anestheticUsed || null,
     complications || null, patientInstructions || null, nextStep || null, returnRecommendedDays || null, userId]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'clinical_evolutions', recordId: record.id, action: 'insert', afterValue: record });
  return record;
}

/**
 * "Corrige" uma evolução: NÃO altera a linha original. Cria uma nova linha
 * com version+1 e supersedes_id apontando para a original, e marca a
 * original como is_current = false. A linha original nunca é tocada.
 */
async function correctClinicalEvolution(client, { evolutionId, clinicId, userId, ...updatedFields }) {
  const { rows: originalRows } = await client.query(
    `SELECT * FROM clinical_evolutions WHERE id = $1 AND clinic_id = $2`, [evolutionId, clinicId]
  );
  const original = originalRows[0];
  if (!original) throw new DomainError('Evolução clínica não encontrada.', 'NOT_FOUND');
  if (!original.is_current) {
    throw new DomainError('Esta evolução já foi substituída por uma versão mais recente. Corrija a versão atual.', 'NOT_CURRENT_VERSION');
  }

  const merged = {
    description: updatedFields.description ?? original.description,
    toothOrRegion: updatedFields.toothOrRegion ?? original.tooth_or_region,
    materialsUsed: updatedFields.materialsUsed ?? original.materials_used,
    medicationsAdministered: updatedFields.medicationsAdministered ?? original.medications_administered,
    anestheticUsed: updatedFields.anestheticUsed ?? original.anesthetic_used,
    complications: updatedFields.complications ?? original.complications,
    patientInstructions: updatedFields.patientInstructions ?? original.patient_instructions,
    nextStep: updatedFields.nextStep ?? original.next_step,
    returnRecommendedDays: updatedFields.returnRecommendedDays ?? original.return_recommended_days,
  };

  const { rows } = await client.query(
    `INSERT INTO clinical_evolutions
      (clinic_id, patient_id, appointment_id, professional_id, procedure_id, tooth_or_region, description,
       materials_used, medications_administered, anesthetic_used, complications, patient_instructions,
       next_step, return_recommended_days, version, supersedes_id, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17)
     RETURNING *`,
    [original.clinic_id, original.patient_id, original.appointment_id, original.professional_id, original.procedure_id,
     merged.toothOrRegion, merged.description, merged.materialsUsed, merged.medicationsAdministered,
     merged.anestheticUsed, merged.complications, merged.patientInstructions, merged.nextStep,
     merged.returnRecommendedDays, original.version + 1, original.id, userId]
  );
  const correctedRecord = rows[0];

  await client.query(`UPDATE clinical_evolutions SET is_current = false WHERE id = $1`, [original.id]);

  await logAudit(client, {
    clinicId, userId, tableName: 'clinical_evolutions', recordId: correctedRecord.id, action: 'correction',
    beforeValue: original, afterValue: correctedRecord,
  });

  return correctedRecord;
}

/** Reconstrói a cadeia de versões de uma evolução (da mais antiga para a mais recente), sem perder nenhuma. */
async function getEvolutionVersionChain(client, clinicId, evolutionId) {
  const { rows } = await client.query(`SELECT * FROM clinical_evolutions WHERE id = $1 AND clinic_id = $2`, [evolutionId, clinicId]);
  let record = rows[0];
  if (!record) throw new DomainError('Evolução clínica não encontrada.', 'NOT_FOUND');

  // Sobe até achar a raiz (a primeira versão, sem supersedes_id)
  while (record.supersedes_id) {
    const { rows: parentRows } = await client.query(`SELECT * FROM clinical_evolutions WHERE id = $1`, [record.supersedes_id]);
    record = parentRows[0];
  }

  // Desce a cadeia inteira a partir da raiz
  const chain = [record];
  let current = record;
  while (true) {
    const { rows: nextRows } = await client.query(`SELECT * FROM clinical_evolutions WHERE supersedes_id = $1`, [current.id]);
    if (nextRows.length === 0) break;
    current = nextRows[0];
    chain.push(current);
  }
  return chain;
}

async function getPatientCurrentEvolutions(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT ce.*, p.full_name AS professional_name FROM clinical_evolutions ce
     JOIN professionals p ON p.id = ce.professional_id
     WHERE ce.clinic_id = $1 AND ce.patient_id = $2 AND ce.is_current = true
     ORDER BY ce.created_at DESC`,
    [clinicId, patientId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// ALERTAS CLÍNICOS (para integrar com a Agenda, seção 4 do briefing original)
// ---------------------------------------------------------------------------

async function getClinicalAlerts(client, clinicId, patientId) {
  const anamnesis = await getCurrentAnamnesis(client, clinicId, patientId);
  if (!anamnesis) return [];

  const alerts = [];
  if (anamnesis.clinical_alerts && anamnesis.clinical_alerts.length > 0) {
    for (const alert of anamnesis.clinical_alerts) {
      alerts.push({ type: 'alerta_clinico', message: alert });
    }
  }
  if (anamnesis.risk_classification && anamnesis.risk_classification !== 'baixo') {
    alerts.push({ type: 'classificacao_risco', message: `Paciente com classificação de risco: ${anamnesis.risk_classification}.` });
  }
  return alerts;
}

module.exports = {
  DomainError,
  createAnamnesisVersion, getCurrentAnamnesis, getAnamnesisHistory,
  addClinicalEvolution, correctClinicalEvolution, getEvolutionVersionChain, getPatientCurrentEvolutions,
  getClinicalAlerts,
};
