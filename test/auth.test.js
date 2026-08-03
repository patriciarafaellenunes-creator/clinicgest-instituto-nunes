// test/auth.test.js
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const jwt = require('jsonwebtoken');
const authService = require('../src/services/authService');

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

  console.log('\n== Teste: validações do bootstrap ==');

  let weakPasswordBlocked = false;
  try {
    await authService.bootstrapClinic(client, {
      companyLegalName: 'Clínica Teste LTDA', clinicName: 'Clínica Teste',
      ownerFullName: 'Dra. Patrícia', ownerEmail: 'patricia@clinicateste.com', ownerPassword: '123',
    });
  } catch (err) {
    weakPasswordBlocked = err.code === 'WEAK_PASSWORD';
  }
  assert(weakPasswordBlocked, 'senha curta demais é rejeitada no bootstrap');

  console.log('\n== Teste: bootstrap cria clínica + usuário proprietário com todas as permissões ==');

  const bootstrap = await authService.bootstrapClinic(client, {
    companyLegalName: 'Clínica Teste LTDA', companyCnpj: '11.222.333/0001-44', clinicName: 'Clínica Teste',
    unitName: 'Unidade Centro', ownerFullName: 'Dra. Patrícia', ownerEmail: 'Patricia@ClinicaTeste.com', ownerPassword: 'senhaForte123',
  });
  assert(bootstrap.user.password_hash === undefined, 'hash da senha nunca é retornado na resposta');
  assert(bootstrap.clinic.name === 'Clínica Teste' && bootstrap.unit.name === 'Unidade Centro', 'clínica e unidade criadas corretamente');

  const permissions = await authService.getUserPermissions(client, bootstrap.user.id);
  assert(permissions.includes('financial:approve') && permissions.includes('documents:create'), 'proprietário recebe todas as permissões do sistema, incluindo ações sensíveis');
  assert(permissions.length === authService.ALL_PERMISSIONS.length, `número de permissões bate com a lista completa (esperado ${authService.ALL_PERMISSIONS.length}, veio ${permissions.length})`);

  console.log('\n== Teste: login com credenciais corretas emite um JWT válido ==');

  const loginResult = await authService.login(client, { email: 'patricia@clinicateste.com', password: 'senhaForte123' });
  assert(loginResult.token, 'login retorna um token');
  assert(loginResult.user.password_hash === undefined, 'hash da senha nunca vaza na resposta de login');

  const decoded = jwt.verify(loginResult.token, process.env.JWT_SECRET || 'dev-secret-change-me');
  assert(decoded.sub === bootstrap.user.id, 'token contém o id de usuário correto');
  assert(decoded.clinicId === bootstrap.clinic.id, 'token contém o id de clínica correto');
  assert(decoded.permissions.includes('financial:approve'), 'permissões corretas embutidas no token — exatamente o que middleware/auth.js vai ler em req.auth.permissions');

  console.log('\n== Teste: login com e-mail é case-insensitive (normalizado no cadastro e no login) ==');

  const loginCaseInsensitive = await authService.login(client, { email: 'PATRICIA@clinicateste.com', password: 'senhaForte123' });
  assert(loginCaseInsensitive.token, 'login funciona independente de maiúsculas/minúsculas no e-mail');

  console.log('\n== Teste: senha errada é rejeitada sem vazar detalhes ==');

  let wrongPasswordBlocked = false;
  try {
    await authService.login(client, { email: 'patricia@clinicateste.com', password: 'senhaErrada' });
  } catch (err) {
    wrongPasswordBlocked = err.code === 'INVALID_CREDENTIALS';
  }
  assert(wrongPasswordBlocked, 'senha incorreta é rejeitada com a mesma mensagem genérica de credenciais inválidas (não revela se o e-mail existe)');

  let unknownEmailBlocked = false;
  try {
    await authService.login(client, { email: 'ninguem@nada.com', password: 'qualquercoisa123' });
  } catch (err) {
    unknownEmailBlocked = err.code === 'INVALID_CREDENTIALS';
  }
  assert(unknownEmailBlocked, 'e-mail inexistente usa a MESMA mensagem de erro que senha errada — não dá pra descobrir se um e-mail está cadastrado só tentando logar');

  console.log('\n== Teste: mesmo e-mail em clínicas diferentes exige desambiguação ==');

  const secondBootstrap = await authService.bootstrapClinic(client, {
    companyLegalName: 'Outra Clínica LTDA', clinicName: 'Outra Clínica',
    ownerFullName: 'Dra. Patrícia (outra clínica)', ownerEmail: 'patricia@clinicateste.com', ownerPassword: 'outraSenhaForte456',
  });

  let ambiguousBlocked = false;
  try {
    await authService.login(client, { email: 'patricia@clinicateste.com', password: 'senhaForte123' });
  } catch (err) {
    ambiguousBlocked = err.code === 'AMBIGUOUS_EMAIL';
  }
  assert(ambiguousBlocked, 'e-mail duplicado em clínicas diferentes exige informar clinicId, em vez de logar na clínica errada por engano');

  const disambiguatedLogin = await authService.login(client, {
    email: 'patricia@clinicateste.com', password: 'senhaForte123', clinicId: bootstrap.clinic.id,
  });
  assert(disambiguatedLogin.user.clinic_id === bootstrap.clinic.id, 'informando clinicId, login funciona corretamente na clínica certa');

  const otherClinicLogin = await authService.login(client, {
    email: 'patricia@clinicateste.com', password: 'outraSenhaForte456', clinicId: secondBootstrap.clinic.id,
  });
  assert(otherClinicLogin.user.clinic_id === secondBootstrap.clinic.id, 'a senha da OUTRA clínica só funciona para a outra clínica, mesmo com o e-mail igual');

  console.log('\nTodos os testes passaram.\n');
  await client.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
