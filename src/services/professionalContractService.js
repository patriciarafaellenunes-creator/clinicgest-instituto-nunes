// src/services/professionalContractService.js
//
// Contrato de profissional (seção 4 do documento 3) usa a central de
// documentos (documentsService) para o ciclo de vida — status, assinatura,
// travamento, revisão — e adiciona uma tabela própria para os dados que o
// SISTEMA precisa consultar, não só um humano ler: quais procedimentos e
// especialidades esse profissional está autorizado a realizar, e as regras
// de remuneração. isProfessionalAuthorized() é o que efetivamente impede
// (não apenas alerta) um profissional de ser escalado fora do que o
// contrato permite — exigência explícita do briefing original.

const documentsService = require('./documentsService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const REMUNERATION_TYPES = ['diaria', 'comissao_producao', 'comissao_recebimento', 'comissao_procedimento', 'fixo'];

async function createProfessionalContract(client, {
  clinicId, unitId, professionalId, content, authorizedSpecialties, authorizedProcedureIds, authorizedUnitIds,
  remunerationType, dailyRate, commissionPercentage, labCostDiscountPercentage, materialCostDiscountPercentage,
  paymentTermDays, validFrom, validUntil, signers, userId,
}) {
  if (remunerationType && !REMUNERATION_TYPES.includes(remunerationType)) {
    throw new DomainError(`Tipo de remuneração inválido: ${remunerationType}`, 'INVALID_REMUNERATION_TYPE');
  }

  if (!signers || signers.length === 0) {
    throw new DomainError('Contrato de profissional precisa de signatários explícitos (ex: profissional e gestor).', 'MISSING_SIGNERS');
  }

  const document = await documentsService.createDocument(client, {
    clinicId, unitId, category: 'contrato_profissional', partyType: 'professional', professionalId,
    content, validFrom, validUntil, signers, userId,
  });

  const { rows } = await client.query(
    `INSERT INTO professional_contract_terms
      (document_id, professional_id, authorized_specialties, authorized_procedure_ids, authorized_unit_ids,
       remuneration_type, daily_rate, commission_percentage, lab_cost_discount_percentage,
       material_cost_discount_percentage, payment_term_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [document.id, professionalId, authorizedSpecialties || null, authorizedProcedureIds || null, authorizedUnitIds || null,
     remunerationType || null, dailyRate || null, commissionPercentage || null, labCostDiscountPercentage || null,
     materialCostDiscountPercentage || null, paymentTermDays || null]
  );

  return { document, terms: rows[0] };
}

async function getProfessionalContractWithTerms(client, clinicId, documentId) {
  const document = await documentsService.getDocumentWithSignatures(client, clinicId, documentId);
  const { rows } = await client.query(`SELECT * FROM professional_contract_terms WHERE document_id = $1`, [documentId]);
  return { ...document, terms: rows[0] || null };
}

/**
 * Verifica se um profissional está autorizado a um procedimento/especialidade,
 * com base no contrato ASSINADO e vigente mais recente. Se o profissional não
 * tem nenhum contrato assinado com termos estruturados no sistema, retorna
 * hasContract=false — quem chama decide se isso bloqueia ou só ignora
 * (no MVP, a agenda só aplica o bloqueio quando existe um contrato de
 * referência, para não travar profissionais que ainda não têm contrato
 * cadastrado no sistema).
 */
/**
 * Retorna os termos do contrato assinado e vigente mais recente do
 * profissional (comissão, diária, especialidades autorizadas), ou null se
 * não houver nenhum. Usado tanto por isProfessionalAuthorized quanto
 * diretamente pelo módulo de cálculo de comissões.
 */
async function getActiveContractTerms(client, clinicId, professionalId) {
  const { rows } = await client.query(
    `SELECT pct.* FROM professional_contract_terms pct
     JOIN documents d ON d.id = pct.document_id
     WHERE d.clinic_id = $1 AND pct.professional_id = $2 AND d.is_current = true AND d.status = 'assinado'
     ORDER BY d.created_at DESC LIMIT 1`,
    [clinicId, professionalId]
  );
  return rows[0] || null;
}

async function isProfessionalAuthorized(client, clinicId, professionalId, { procedureId, specialty, unitId } = {}) {
  const terms = await getActiveContractTerms(client, clinicId, professionalId);
  if (!terms) return { hasContract: false, authorized: true };

  let authorized = true;
  if (procedureId && terms.authorized_procedure_ids && terms.authorized_procedure_ids.length > 0) {
    authorized = authorized && terms.authorized_procedure_ids.includes(procedureId);
  }
  if (specialty && terms.authorized_specialties && terms.authorized_specialties.length > 0) {
    authorized = authorized && terms.authorized_specialties.includes(specialty);
  }
  if (unitId && terms.authorized_unit_ids && terms.authorized_unit_ids.length > 0) {
    authorized = authorized && terms.authorized_unit_ids.includes(unitId);
  }

  return { hasContract: true, authorized, terms };
}

module.exports = {
  DomainError, REMUNERATION_TYPES,
  createProfessionalContract, getProfessionalContractWithTerms, isProfessionalAuthorized, getActiveContractTerms,
};
