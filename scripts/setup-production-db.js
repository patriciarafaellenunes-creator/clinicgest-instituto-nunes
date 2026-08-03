// scripts/setup-production-db.js
//
// Prepara um Postgres real (Supabase ou qualquer outro) para rodar o
// ClinicGest: aplica o schema (02-schema-mvp.sql), aplica a política de
// isolamento entre clínicas (03-row-level-security.sql), e cria as duas
// roles de aplicação com senhas novas geradas na hora — a role comum
// (protegida por RLS de verdade) e a role só para login/criação de clínica
// (com BYPASSRLS, usada apenas por essas duas rotas específicas).
//
// Roda uma vez só, conectado como o usuário admin/superusuário do banco
// (ex: o usuário "postgres" que o Supabase cria por padrão). Nunca usa essa
// conexão de admin para a aplicação em si — só para esta preparação.
//
// Uso:
//   ADMIN_PGHOST=... ADMIN_PGPASSWORD=... ADMIN_PGDATABASE=postgres node scripts/setup-production-db.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

function generatePassword() {
  return crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
}

async function main() {
  const client = new Client({
    host: process.env.ADMIN_PGHOST,
    port: process.env.ADMIN_PGPORT || 5432,
    user: process.env.ADMIN_PGUSER || 'postgres',
    password: process.env.ADMIN_PGPASSWORD,
    database: process.env.ADMIN_PGDATABASE || 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Conectado ao banco como', process.env.ADMIN_PGUSER || 'postgres');

  const schemaSql = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  await client.query(schemaSql);
  console.log('02-schema-mvp.sql aplicado.');

  const rlsSql = fs.readFileSync(path.join(__dirname, '..', '03-row-level-security.sql'), 'utf8');
  await client.query(rlsSql);
  console.log('03-row-level-security.sql aplicado.');

  const appPassword = generatePassword();
  const authPassword = generatePassword();

  await client.query(`DROP ROLE IF EXISTS app_user`);
  await client.query(`DROP ROLE IF EXISTS auth_service_user`);
  await client.query(`CREATE ROLE app_user LOGIN PASSWORD '${appPassword}'`);
  await client.query(`CREATE ROLE auth_service_user LOGIN PASSWORD '${authPassword}' BYPASSRLS`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, auth_service_user`);
  await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user, auth_service_user`);
  console.log('Roles app_user e auth_service_user criadas.');

  await client.end();

  console.log('\n=== Cole isto no seu .env (substitua os valores de PG* existentes) ===');
  console.log(`PGHOST=${process.env.ADMIN_PGHOST}`);
  console.log(`PGPORT=${process.env.ADMIN_PGPORT || 5432}`);
  console.log(`PGUSER=app_user`);
  console.log(`PGPASSWORD=${appPassword}`);
  console.log(`PGDATABASE=${process.env.ADMIN_PGDATABASE || 'postgres'}`);
  console.log(`AUTH_PGUSER=auth_service_user`);
  console.log(`AUTH_PGPASSWORD=${authPassword}`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('FALHOU:', err.message);
  process.exit(1);
});
