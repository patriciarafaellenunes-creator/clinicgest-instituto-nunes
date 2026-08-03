// src/services/supplierContractService.js
//
// Contratos de fornecedor (seção 6) e laboratório (seção 5) do documento 3.
// Reaproveitam a tabela `suppliers` já existente desde a Fase 1 — um
// laboratório é, para fins de dados cadastrais, o mesmo tipo de entidade
// que um fornecedor (razão social, CNPJ, contatos). O que diferencia é o
// `category`/`partyType` do documento e os termos estruturados do contrato
// (prazos, garantia, política de refazimento). Diferente do contrato de
// profissional, aqui não existe uma regra de bloqueio equivalente no
// briefing — o valor é ter os dados estruturados e rastreáveis (vencimento,
// condições) para consulta e automação.

const documentsService = require('./documentsService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const CONTRACT_SUBTYPES = [
  'fornecimento', 'compra_recorrente', 'comodato', 'locacao_equipamento', 'manutencao', 'suporte',
  'prestacao_servicos_laboratoriais', 'fornecimento_proteses',
];

async function createSupplierContract(client, {
  clinicId, unitId, supplierId, partyType, content, contractSubtype, productsOrServices, priceTable,
  deliveryTermDays, warrantyDays, reworkPolicy, paymentTerms, penalties, qualityCriteria,
  validFrom, validUntil, signers, userId,
}) {
  if (!['supplier', 'lab'].includes(partyType)) {
    throw new DomainError(`Tipo de parte inválido para este contrato: ${partyType}`, 'INVALID_PARTY_TYPE');
  }
  if (contractSubtype && !CONTRACT_SUBTYPES.includes(contractSubtype)) {
    throw new DomainError(`Subtipo de contrato inválido: ${contractSubtype}`, 'INVALID_SUBTYPE');
  }
  if (!signers || signers.length === 0) {
    throw new DomainError('Contrato precisa de signatários explícitos (ex: representante do fornecedor/laboratório e gestor).', 'MISSING_SIGNERS');
  }

  const category = partyType === 'lab' ? 'contrato_laboratorio' : 'contrato_fornecedor';

  const document = await documentsService.createDocument(client, {
    clinicId, unitId, category, partyType, supplierId, content, validFrom, validUntil, signers, userId,
  });

  const { rows } = await client.query(
    `INSERT INTO supplier_contract_terms
      (document_id, supplier_id, contract_subtype, products_or_services, price_table, delivery_term_days,
       warranty_days, rework_policy, payment_terms, penalties, quality_criteria)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [document.id, supplierId, contractSubtype || null, productsOrServices || null,
     priceTable ? JSON.stringify(priceTable) : null, deliveryTermDays || null, warrantyDays || null,
     reworkPolicy || null, paymentTerms || null, penalties || null, qualityCriteria || null]
  );

  return { document, terms: rows[0] };
}

async function getSupplierContractWithTerms(client, clinicId, documentId) {
  const document = await documentsService.getDocumentWithSignatures(client, clinicId, documentId);
  const { rows } = await client.query(`SELECT * FROM supplier_contract_terms WHERE document_id = $1`, [documentId]);
  return { ...document, terms: rows[0] || null };
}

/** Contrato assinado e vigente mais recente para um fornecedor/laboratório — o que vale para consulta de garantia/prazo. */
async function getActiveSupplierContract(client, clinicId, supplierId, { category } = {}) {
  const params = [clinicId, supplierId];
  let filter = '';
  if (category) {
    params.push(category);
    filter = ` AND d.category = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT d.*, sct.* FROM supplier_contract_terms sct
     JOIN documents d ON d.id = sct.document_id
     WHERE d.clinic_id = $1 AND sct.supplier_id = $2 AND d.is_current = true AND d.status = 'assinado'${filter}
     ORDER BY d.created_at DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  DomainError, CONTRACT_SUBTYPES,
  createSupplierContract, getSupplierContractWithTerms, getActiveSupplierContract,
};
