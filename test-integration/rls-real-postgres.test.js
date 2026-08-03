// test-integration/rls-real-postgres.test.js
//
// Diferente de tudo em test/, este arquivo NÃO roda contra pg-mem — ele
// precisa de um PostgreSQL de verdade, porque testa row-level security e
// current_setting/set_config, que pg-mem não implementa. Roda contra o
// banco apontado pelas variáveis PGHOST/PGUSER/PGPASSWORD/PGDATABASE e
// AUTH_PGUSER/AUTH_PGPASSWORD (a role com BYPASSRLS usada só pelo
// auth service).
//
// Pré-requisitos antes de rodar (ver README + 03-row-level-security.sql):
//   1. psql -f 02-schema-mvp.sql seu_banco
//   2. psql -f 03-row-level-security.sql seu_banco
//   3. Criar as duas roles:
//        CREATE ROLE app_user LOGIN PASSWORD '...';
//        CREATE ROLE auth_service_user LOGIN PASSWORD '...' BYPASSRLS;
//        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, auth_service_user;
//        GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user, auth_service_user;
//   4. Seedar duas clínicas de teste com um paciente cada (ver README para o SQL exato).
//
// Uso: node test-integration/rls-real-postgres.test.js
// (lê PGHOST/PGUSER/PGPASSWORD/etc. do .env na raiz do projeto automaticamente;
// pode também sobrescrever passando as variáveis na linha de comando)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'app_user';
process.env.PGPASSWORD = process.env.PGPASSWORD || '';
process.env.PGDATABASE = process.env.PGDATABASE || 'clinicgest_test';
process.env.AUTH_PGUSER = process.env.AUTH_PGUSER || 'auth_service_user';
process.env.AUTH_PGPASSWORD = process.env.AUTH_PGPASSWORD || '';

const { withAuthClient, withTenantClient, pool, authPool } = require('../src/db/pool');
const authService = require('../src/services/authService');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

async function main() {
  console.log('\n== Fluxo completo de produção: authPool (bypassRLS) + pool comum (RLS forçado) ==');

  const bootstrap = await withAuthClient((client) =>
    authService.bootstrapClinic(client, {
      companyLegalName: 'Clinica Bootstrap Real LTDA', clinicName: 'Clinica Bootstrap Real',
      ownerFullName: 'Dra. Teste', ownerEmail: `teste-${Date.now()}@bootstrapreal.com`, ownerPassword: 'senhaForte123',
    })
  );
  assert(bootstrap.clinic.name === 'Clinica Bootstrap Real', 'bootstrap-clinic funciona via authPool (bypassRLS)');

  const loginResult = await withAuthClient((client) =>
    authService.login(client, { email: bootstrap.user.email, password: 'senhaForte123' })
  );
  assert(loginResult.token, 'login funciona via authPool, mesmo sem saber o clinicId de antemão');

  const unitsVisible = await withTenantClient(bootstrap.clinic.id, async (client) => {
    const { rows } = await client.query('SELECT * FROM units WHERE clinic_id = $1', [bootstrap.clinic.id]);
    return rows;
  });
  assert(unitsVisible.length === 1, 'com app_user (RLS de verdade) e o clinicId certo, a clínica criada no bootstrap é visível');

  const crossTenantLeak = await withTenantClient(bootstrap.clinic.id, async (client) => {
    const { rows } = await client.query(`SELECT * FROM units WHERE clinic_id != $1`, [bootstrap.clinic.id]);
    return rows;
  });
  assert(crossTenantLeak.length === 0, 'app_user (role sem bypass) nunca vaza dado de outra clínica, mesmo pedindo explicitamente');

  let appUserCannotBypassLogin = false;
  try {
    await withTenantClient(null, async (client) => {
      const { rows } = await client.query(`SELECT * FROM users WHERE email = $1`, [bootstrap.user.email]);
      return rows;
    });
  } catch (err) {
    appUserCannotBypassLogin = true;
  }
  assert(appUserCannotBypassLogin, 'a role comum (app_user) não consegue fazer a busca "cega" que o login precisa -- só authPool consegue, por desenho');

  console.log('\nTodos os testes do fluxo completo de produção passaram.\n');
  await pool.end();
  await authPool.end();
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
