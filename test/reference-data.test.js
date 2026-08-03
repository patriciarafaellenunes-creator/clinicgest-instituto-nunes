// test/reference-data.test.js
//
// professionalsService e proceduresService são cadastros básicos (nome +
// alguns campos), pequenos demais para justificar um arquivo de teste cada
// um — cobertos juntos aqui.
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const professionalsService = require('../src/services/professionalsService');
const proceduresService = require('../src/services/proceduresService');
const unitsService = require('../src/services/unitsService');
const suppliersService = require('../src/services/suppliersService');
const bankAccountsService = require('../src/services/bankAccountsService');

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

  await client.query(`INSERT INTO companies (id, legal_name) VALUES ($1,'Clínica Teste LTDA')`, [companyId]);
  await client.query(`INSERT INTO clinics (id, company_id, name) VALUES ($1,$2,'Clínica Teste')`, [clinicId, companyId]);

  console.log('\n== Teste: profissionais ==');

  let missingNameBlocked = false;
  try {
    await professionalsService.createProfessional(client, { clinicId, fullName: '', professionalRole: 'dentista' });
  } catch (err) {
    missingNameBlocked = err.code === 'INVALID_NAME';
  }
  assert(missingNameBlocked, 'profissional sem nome é rejeitado');

  const prof = await professionalsService.createProfessional(client, {
    clinicId, fullName: 'Dra. Ana Paula', professionalRole: 'dentista', councilRegistration: 'CRO-12345',
  });
  assert(prof.is_active === true, 'profissional criado ativo por padrão');

  const inactiveProf = await professionalsService.createProfessional(client, { clinicId, fullName: 'Dr. Inativo', professionalRole: 'dentista' });
  await client.query(`UPDATE professionals SET is_active = false WHERE id = $1`, [inactiveProf.id]);

  const activeList = await professionalsService.listProfessionals(client, clinicId);
  assert(activeList.length === 1 && activeList[0].full_name === 'Dra. Ana Paula', 'listagem padrão só traz profissionais ativos');

  const allList = await professionalsService.listProfessionals(client, clinicId, { activeOnly: false });
  assert(allList.length === 2, 'listagem com activeOnly=false traz todos, inclusive inativos');

  console.log('\n== Teste: procedimentos ==');

  let missingProcNameBlocked = false;
  try {
    await proceduresService.createProcedure(client, { clinicId, name: '' });
  } catch (err) {
    missingProcNameBlocked = err.code === 'INVALID_NAME';
  }
  assert(missingProcNameBlocked, 'procedimento sem nome é rejeitado');

  await proceduresService.createProcedure(client, { clinicId, name: 'Limpeza', defaultPrice: 200, specialty: 'Clínica geral' });
  await proceduresService.createProcedure(client, { clinicId, name: 'Implante', defaultPrice: 4000, specialty: 'Implantodontia' });

  const procedures = await proceduresService.listProcedures(client, clinicId);
  assert(procedures.length === 2, 'lista os dois procedimentos cadastrados');
  assert(procedures.some((p) => p.name === 'Implante' && Number(p.default_price) === 4000), 'procedimento retorna o preço padrão correto');

  console.log('\n== Teste: unidades ==');

  const units = await unitsService.listUnits(client, clinicId);
  assert(units.length === 0, 'clínica recém-criada sem unidade própria (esta clínica de teste não passou pelo bootstrap) retorna lista vazia, não erro');

  await client.query(`INSERT INTO units (clinic_id, name) VALUES ($1,'Unidade Principal')`, [clinicId]);
  const unitsAfter = await unitsService.listUnits(client, clinicId);
  assert(unitsAfter.length === 1 && unitsAfter[0].name === 'Unidade Principal', 'lista a unidade cadastrada');

  console.log('\n== Teste: fornecedores ==');

  let missingSupplierNameBlocked = false;
  try {
    await suppliersService.createSupplier(client, { clinicId, legalName: '' });
  } catch (err) {
    missingSupplierNameBlocked = err.code === 'INVALID_NAME';
  }
  assert(missingSupplierNameBlocked, 'fornecedor sem razão social é rejeitado');

  await suppliersService.createSupplier(client, { clinicId, legalName: 'Laboratório Sorriso Prime', cnpjCpf: '11.222.333/0001-44' });
  const suppliers = await suppliersService.listSuppliers(client, clinicId);
  assert(suppliers.length === 1 && suppliers[0].legal_name === 'Laboratório Sorriso Prime', 'lista o fornecedor cadastrado');

  console.log('\n== Teste: contas bancárias ==');

  let missingAccountNameBlocked = false;
  try {
    await bankAccountsService.createBankAccount(client, { clinicId, name: '' });
  } catch (err) {
    missingAccountNameBlocked = err.code === 'INVALID_NAME';
  }
  assert(missingAccountNameBlocked, 'conta bancária sem nome é rejeitada');

  await bankAccountsService.createBankAccount(client, { clinicId, name: 'Caixa', initialBalance: 500 });
  const accounts = await bankAccountsService.listBankAccounts(client, clinicId);
  assert(accounts.length === 1 && Number(accounts[0].current_balance) === 500, 'lista a conta bancária com o saldo inicial correto');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
