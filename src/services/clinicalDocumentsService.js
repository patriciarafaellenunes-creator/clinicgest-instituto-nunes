// src/services/clinicalDocumentsService.js
//
// Regra central (seção "Prescrições, atestados e documentos clínicos" do
// documento 2): um documento emitido não é editado. Se o profissional errou
// algo, o caminho é CANCELAR (com motivo, registrado) e emitir outro — nunca
// alterar o conteúdo do que já foi impresso/entregue ao paciente. Isso
// existe porque esses documentos têm valor legal (um atestado errado que
// "sumisse" silenciosamente seria um problema jurídico sério).

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const DOCUMENT_TYPES = [
  'receita_simples', 'receita_controle_especial', 'atestado',
  'declaracao_comparecimento', 'solicitacao_exame', 'encaminhamento', 'relatorio_clinico',
];

// Validação mínima de conteúdo por tipo — cada tipo de documento exige campos diferentes.
function validateContent(documentType, content) {
  if (!content || typeof content !== 'object') {
    throw new DomainError('Conteúdo do documento é obrigatório.', 'MISSING_CONTENT');
  }

  switch (documentType) {
    case 'receita_simples':
    case 'receita_controle_especial':
      if (!Array.isArray(content.medications) || content.medications.length === 0) {
        throw new DomainError('Receita precisa de ao menos um medicamento.', 'MISSING_MEDICATIONS');
      }
      for (const med of content.medications) {
        if (!med.name || !med.dosage) throw new DomainError('Cada medicamento precisa de nome e dosagem.', 'INVALID_MEDICATION');
      }
      break;
    case 'atestado':
      if (!content.daysOff || content.daysOff < 1) {
        throw new DomainError('Atestado precisa informar o número de dias de afastamento.', 'MISSING_DAYS_OFF');
      }
      break;
    case 'declaracao_comparecimento':
      if (!content.attendanceDate) throw new DomainError('Declaração de comparecimento precisa da data.', 'MISSING_ATTENDANCE_DATE');
      break;
    case 'solicitacao_exame':
      if (!Array.isArray(content.examsRequested) || content.examsRequested.length === 0) {
        throw new DomainError('Solicitação de exame precisa listar ao menos um exame.', 'MISSING_EXAMS');
      }
      break;
    case 'encaminhamento':
      if (!content.destinationSpecialty) throw new DomainError('Encaminhamento precisa da especialidade de destino.', 'MISSING_DESTINATION');
      break;
    case 'relatorio_clinico':
      if (!content.text || !content.text.trim()) throw new DomainError('Relatório clínico precisa de texto.', 'MISSING_REPORT_TEXT');
      break;
    default:
      break;
  }
}

async function issueDocument(client, { clinicId, patientId, professionalId, appointmentId, documentType, content, userId }) {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw new DomainError(`Tipo de documento inválido: ${documentType}`, 'INVALID_DOCUMENT_TYPE');
  }
  validateContent(documentType, content);

  const { rows } = await client.query(
    `INSERT INTO clinical_documents (clinic_id, patient_id, professional_id, appointment_id, document_type, content, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'emitido',$7)
     RETURNING *`,
    [clinicId, patientId, professionalId, appointmentId || null, documentType, JSON.stringify(content), userId]
  );
  const record = rows[0];

  await logAudit(client, { clinicId, userId, tableName: 'clinical_documents', recordId: record.id, action: 'issue', afterValue: record });
  return record;
}

async function cancelDocument(client, { id, clinicId, userId, reason }) {
  if (!reason || !reason.trim()) throw new DomainError('Motivo do cancelamento é obrigatório.', 'REASON_REQUIRED');

  const { rows: beforeRows } = await client.query(`SELECT * FROM clinical_documents WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  const before = beforeRows[0];
  if (!before) throw new DomainError('Documento não encontrado.', 'NOT_FOUND');
  if (before.status === 'cancelado') throw new DomainError('Documento já está cancelado.', 'ALREADY_CANCELLED');

  const { rows } = await client.query(
    `UPDATE clinical_documents SET status = 'cancelado', cancelled_at = now(), cancelled_reason = $1, cancelled_by = $2
     WHERE id = $3 RETURNING *`,
    [reason.trim(), userId, id]
  );

  await logAudit(client, { clinicId, userId, tableName: 'clinical_documents', recordId: id, action: 'cancel', beforeValue: before, afterValue: rows[0] });
  return rows[0];
}

async function getDocument(client, clinicId, id) {
  const { rows } = await client.query(`SELECT * FROM clinical_documents WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  if (!rows[0]) throw new DomainError('Documento não encontrado.', 'NOT_FOUND');
  return rows[0];
}

async function getPatientDocuments(client, clinicId, patientId, { documentType } = {}) {
  const params = [clinicId, patientId];
  let filter = '';
  if (documentType) {
    params.push(documentType);
    filter = ` AND document_type = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT * FROM clinical_documents WHERE clinic_id = $1 AND patient_id = $2${filter} ORDER BY issued_at DESC`,
    params
  );
  return rows;
}

module.exports = {
  DomainError, DOCUMENT_TYPES,
  issueDocument, cancelDocument, getDocument, getPatientDocuments,
};
