// src/services/documentAutomationService.js
//
// Automações do documento 3 (seção 11): eventos do sistema disparando
// geração de documentos, em vez de alguém lembrar de fazer isso na mão.
//
// Regra de design importante: a automação GERA o documento (rascunho, com
// texto pronto), mas NUNCA assina sozinha — assinatura continua exigindo
// uma ação humana (ver documentsService.recordSignature). Isso está de
// acordo com a seção 12 do documento 3: "o agente/sistema pode gerar
// minutas... mas nunca assinar documentos sozinho".
//
// Este service não reimplementa nada: orquestra treatmentPlanService,
// documentsService e termsLibraryService na ordem certa, para evitar a
// dependência circular que existiria se treatmentPlanService chamasse
// documentsService diretamente para isso.

const treatmentPlanService = require('./treatmentPlanService');
const documentsService = require('./documentsService');
const termsLibraryService = require('./termsLibraryService');

/**
 * Aprova um plano de tratamento E, na mesma operação, gera (como rascunho)
 * os termos de consentimento obrigatórios ainda faltantes para os
 * procedimentos aceitos pelo paciente. Idempotente: rodar de novo não gera
 * documentos duplicados — se já existe um documento (mesmo que ainda não
 * assinado) para aquele modelo/paciente, ele é reaproveitado.
 */
async function approveTreatmentPlanWithAutomation(client, { planId, clinicId, unitId, userId }) {
  const plan = await treatmentPlanService.updatePlanStatus(client, { id: planId, clinicId, userId, status: 'aprovado' });
  const generatedDocuments = await generateRequiredDocumentsForPlan(client, { planId, clinicId, unitId, userId });
  return { plan, generatedDocuments };
}

async function generateRequiredDocumentsForPlan(client, { planId, clinicId, unitId, userId }) {
  const fullPlan = await treatmentPlanService.getTreatmentPlanWithItems(client, clinicId, planId);

  const { rows: patientRows } = await client.query(`SELECT full_name FROM patients WHERE id = $1`, [fullPlan.patient_id]);
  const { rows: professionalRows } = await client.query(`SELECT full_name FROM professionals WHERE id = $1`, [fullPlan.professional_id]);
  const patientName = patientRows[0] ? patientRows[0].full_name : null;
  const professionalName = professionalRows[0] ? professionalRows[0].full_name : null;

  const acceptedProcedureIds = [...new Set(fullPlan.items.filter((i) => i.patient_decision === 'aceito').map((i) => i.procedure_id))];

  const generated = [];
  const handledTemplateIds = new Set();

  for (const procedureId of acceptedProcedureIds) {
    const check = await documentsService.checkRequiredDocumentsForProcedure(client, clinicId, fullPlan.patient_id, procedureId);

    for (const missing of check.missing) {
      if (handledTemplateIds.has(missing.templateId)) continue;
      handledTemplateIds.add(missing.templateId);

      // Evita duplicar rascunho se já existe um documento (assinado ou não) em aberto para este modelo/paciente.
      const { rows: existing } = await client.query(
        `SELECT id FROM documents WHERE clinic_id = $1 AND patient_id = $2 AND template_id = $3 AND is_current = true AND status != 'cancelado'`,
        [clinicId, fullPlan.patient_id, missing.templateId]
      );
      if (existing.length > 0) continue;

      const doc = await termsLibraryService.instantiateDocumentFromTemplate(client, {
        templateId: missing.templateId, clinicId, unitId, patientId: fullPlan.patient_id, professionalId: fullPlan.professional_id,
        patientName, professionalName, relatedProcedureId: procedureId, relatedTreatmentPlanId: planId, userId,
      });
      generated.push(doc);
    }
  }

  return generated;
}

/**
 * Cria notificações para contratos/termos vencendo em N dias. Idempotente
 * por documento: não duplica notificação para o mesmo documento enquanto a
 * anterior ainda não foi lida.
 */
async function notifyExpiringContracts(client, { clinicId, days = 30, userId }) {
  const expiring = await documentsService.getExpiringDocuments(client, clinicId, days);
  const created = [];

  for (const doc of expiring) {
    const marker = `[doc:${doc.id}]`;
    const { rows: existing } = await client.query(
      `SELECT id FROM notifications WHERE clinic_id = $1 AND body LIKE $2 AND is_read = false`,
      [clinicId, `%${marker}%`]
    );
    if (existing.length > 0) continue;

    const { rows } = await client.query(
      `INSERT INTO notifications (clinic_id, user_id, title, body) VALUES ($1,$2,$3,$4) RETURNING *`,
      [clinicId, userId || null, 'Contrato próximo do vencimento',
       `O documento da categoria "${doc.category}" vence em ${doc.valid_until}. ${marker}`]
    );
    created.push(rows[0]);
  }

  return created;
}

module.exports = { approveTreatmentPlanWithAutomation, generateRequiredDocumentsForPlan, notifyExpiringContracts };
