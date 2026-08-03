// test/supplier-contracts.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const supplierContractService = require('../src/services/supplierContractService');
const documentsService = require('../src/services/documentsService');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

async function main() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => require('crypto').randomUUID(),
    impure: true,
  });

  let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  schema = schema.replace(/CREATE EXTENSION.*\n/g, '');
  db.public.none(schema);

  const { Client } = db.adapters.createPg();
  const client = new Client();
  await client.connect();

  const { randomUUID } = require('crypto');
  const companyId = randomUUID();
  const clinicId = randomUUID();
  const userId = randomUUID();
  const supplierId = randomUUID();

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);
  await client.query(`INSERT INTO users (id, clinic_id, full_name, email, password_hash) VALUES ($1,$2,'Gestora','g@test.com','x')`, [userId, clinicId]);
  // Mesma entidade cadastrada como fornecedor: presta serviço de laboratório de próteses E também vende material de escritório
  await client.query(`INSERT INTO suppliers (id, clinic_id, legal_name, trade_name) VALUES ($1,$2,'Prótese Labs & Papelaria LTDA','Prótese Labs')`, [supplierId, clinicId]);

  console.log('\n== Teste: validações de criação ==');

  let invalidSubtypeBlocked = false;
  try {
    await supplierContractService.createSupplierContract(client, {
      clinicId, supplierId, partyType: 'lab', content: 'Contrato...', contractSubtype: 'venda_de_sonhos', userId,
    });
  } catch (err) {
    invalidSubtypeBlocked = err.code === 'INVALID_SUBTYPE';
  }
  assert(invalidSubtypeBlocked, 'subtipo de contrato fora da lista permitida é rejeitado');

  console.log('\n== Teste: contrato de laboratório com termos estruturados ==');

  const { document: labDoc, terms: labTerms } = await supplierContractService.createSupplierContract(client, {
    clinicId, supplierId, partyType: 'lab', content: 'Contrato de prestação de serviços laboratoriais — próteses.',
    contractSubtype: 'prestacao_servicos_laboratoriais', productsOrServices: ['Prótese total', 'Coroa em zircônia'],
    priceTable: { protese_total: 800, coroa_zirconia: 650 }, deliveryTermDays: 10, warrantyDays: 365,
    reworkPolicy: 'Refazimento gratuito em até 30 dias em caso de não conformidade.',
    signers: [{ signerName: 'Responsável Técnico do Laboratório', signerRole: 'laboratorio' }, { signerName: 'Gestora', signerRole: 'gestor' }],
    userId,
  });
  assert(labDoc.category === 'contrato_laboratorio', 'documento criado com categoria de contrato de laboratório');
  assert(labTerms.warranty_days === 365 && labTerms.delivery_term_days === 10, 'prazos e garantia salvos corretamente');

  console.log('\n== Teste: contrato de fornecedor comum, mesma entidade ==');

  const { document: supplierDoc } = await supplierContractService.createSupplierContract(client, {
    clinicId, supplierId, partyType: 'supplier', content: 'Contrato de fornecimento de material de escritório.',
    contractSubtype: 'compra_recorrente', productsOrServices: ['Papel A4', 'Toner de impressora'],
    paymentTerms: '30 dias', deliveryTermDays: 5,
    signers: [{ signerName: 'Representante Comercial', signerRole: 'fornecedor' }, { signerName: 'Gestora', signerRole: 'gestor' }],
    userId,
  });
  assert(supplierDoc.category === 'contrato_fornecedor', 'mesma entidade também tem um contrato de fornecedor comum, categoria diferente');
  assert(supplierDoc.id !== labDoc.id, 'os dois contratos são documentos distintos, mesmo sendo o mesmo fornecedor');

  console.log('\n== Teste: contrato ativo é filtrável por categoria (mesma entidade, papéis diferentes) ==');

  const activeBeforeSigning = await supplierContractService.getActiveSupplierContract(client, clinicId, supplierId, { category: 'contrato_laboratorio' });
  assert(activeBeforeSigning === null, 'antes de assinar, não há contrato ativo ainda (rascunho não conta)');

  const labWithSigs = await documentsService.getDocumentWithSignatures(client, clinicId, labDoc.id);
  for (const sig of labWithSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: labDoc.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'link_seguro' });
  }

  const activeLabContract = await supplierContractService.getActiveSupplierContract(client, clinicId, supplierId, { category: 'contrato_laboratorio' });
  assert(activeLabContract && activeLabContract.rework_policy.includes('Refazimento gratuito'), 'contrato de laboratório assinado aparece como ativo, com a política de refazimento correta');

  const activeSupplierContractStillNull = await supplierContractService.getActiveSupplierContract(client, clinicId, supplierId, { category: 'contrato_fornecedor' });
  assert(activeSupplierContractStillNull === null, 'contrato de fornecedor comum ainda não assinado não aparece como ativo, mesmo com o de laboratório já valendo (são independentes)');

  const supplierWithSigs = await documentsService.getDocumentWithSignatures(client, clinicId, supplierDoc.id);
  for (const sig of supplierWithSigs.signatures) {
    await documentsService.recordSignature(client, { documentId: supplierDoc.id, signatureId: sig.id, clinicId, userId, signatureMethod: 'codigo_email' });
  }

  const activeSupplierContract = await supplierContractService.getActiveSupplierContract(client, clinicId, supplierId, { category: 'contrato_fornecedor' });
  assert(activeSupplierContract && activeSupplierContract.payment_terms === '30 dias', 'agora sim o contrato de fornecedor comum aparece como ativo, separado do contrato de laboratório');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
