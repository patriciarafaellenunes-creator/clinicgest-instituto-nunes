// src/db/pool.js
// Pool de conexão com o PostgreSQL. Em produção, as credenciais vêm de variáveis
// de ambiente (nunca hardcoded). O helper `withClient` garante que toda operação
// financeira multi-passo (ex: baixa de parcela -> lançamento em caixa -> auditoria)
// rode dentro de uma única transação, evitando estados inconsistentes.

const { Pool } = require('pg');

// Bancos gerenciados (Supabase, Railway, etc.) exigem conexão criptografada.
// PGSSL=true liga isso; em desenvolvimento local (Postgres sem SSL configurado
// ou o simulador em memória) fica desligado por padrão.
const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'clinicgest',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'clinicgest',
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
});

/**
 * Pool separado, usado SÓ por authService (login e bootstrap-clinic). Esses
 * dois fluxos legitimamente precisam consultar a tabela `users` sem
 * conhecer o clinic_id de antemão — login busca por e-mail podendo cruzar
 * clínicas antes de saber qual é a certa, e bootstrap-clinic cria uma
 * clínica que ainda não existe. Isso não dá pra fazer com a role comum sob
 * row-level security (ver 03-row-level-security.sql) sem abrir uma
 * política permissiva demais nas tabelas de identidade.
 *
 * A solução correta é uma credencial separada, com o atributo BYPASSRLS,
 * usada exclusivamente por essas duas operações — nunca pelas rotas
 * autenticadas normais, que continuam usando `pool`/`withTenantClient`
 * (role comum, sem BYPASSRLS, protegida de verdade pelo RLS). Se
 * AUTH_PGUSER não estiver configurado, cai para as mesmas credenciais de
 * `pool` — funciona sem RLS habilitado (ambiente de desenvolvimento), mas
 * não deve ser usado assim em produção com RLS ativo.
 */
const authPool = new Pool({
  host: process.env.AUTH_PGHOST || process.env.PGHOST || 'localhost',
  port: process.env.AUTH_PGPORT || process.env.PGPORT || 5432,
  user: process.env.AUTH_PGUSER || process.env.PGUSER || 'clinicgest',
  password: process.env.AUTH_PGPASSWORD || process.env.PGPASSWORD || '',
  database: process.env.AUTH_PGDATABASE || process.env.PGDATABASE || 'clinicgest',
  ssl,
  max: 5,
  idleTimeoutMillis: 30000,
});

/**
 * Executa `fn` dentro de uma transação. Faz ROLLBACK automático em caso de erro.
 * Uso: await withClient(async (client) => { ... client.query(...) ... });
 */
async function withClient(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Define a variável de sessão que as políticas de row-level security (ver
 * 03-row-level-security.sql) usam para filtrar por clínica. Usa
 * set_config(), não SET LOCAL com concatenação de string — SET não aceita
 * parâmetros preparados, então essa é a forma segura de fazer isso sem
 * risco de injeção mesmo que clinicId venha de uma fonte não confiável.
 * O terceiro argumento `true` faz o efeito durar só a transação atual
 * (equivalente a SET LOCAL), não a conexão inteira.
 */
async function setTenantContext(client, clinicId) {
  if (!clinicId) return;
  await client.query(`SELECT set_config('app.current_clinic_id', $1, true)`, [clinicId]);
}

/**
 * Mesma coisa que withClient, mas também define o contexto de clínica da
 * sessão antes de rodar `fn` — é o que faz o row-level security do banco
 * (se estiver habilitado via 03-row-level-security.sql) realmente filtrar
 * por clínica, em vez de depender só do WHERE clinic_id = $1 que cada
 * service já escreve. Defesa em profundidade: mesmo que uma query
 * esquecesse o filtro por clínica, o banco ainda bloquearia o vazamento.
 */
async function withTenantClient(clinicId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, clinicId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mesmo padrão de withClient, mas usando o authPool (credenciais com
 * BYPASSRLS em produção) — só para authService.login e
 * authService.bootstrapClinic. Nenhuma outra rota deve usar isto.
 */
async function withAuthClient(fn) {
  const client = await authPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, authPool, withClient, withAuthClient, withTenantClient, setTenantContext };
