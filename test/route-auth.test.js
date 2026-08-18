// test/route-auth.test.js
//
// test/webhooks.test.js foi o primeiro arquivo a testar uma rota pela
// camada HTTP; este é o segundo, e cobre o padrão oposto: rotas
// autenticadas. requireAuth/requirePermission (src/middleware/auth.js) são
// aplicados em ~30 arquivos de rota, sempre à mão (`router.use(requireAuth)`
// + `requirePermission('modulo','acao')` em cada endpoint) — um erro de
// copiar-e-colar aí (ex: exigir 'financial:view' num endpoint que deveria
// exigir 'financial:view_financial_values') é um bug real de controle de
// acesso que nenhum teste de service pega, porque os testes de service
// chamam a função direto, pulando o middleware inteiro.
//
// Parte 1: testa requireAuth/requirePermission isoladamente, com req/res/
// next falsos (sem precisar montar um servidor).
// Parte 2: monta 3 rotas reais (patients, agenda, financial) num Express de
// verdade e bate nelas por HTTP, provando que o middleware está de fato
// conectado do jeito certo em cada uma — inclusive o caso em financial.js
// onde duas rotas do MESMO arquivo exigem permissões diferentes.
//
// pool.connect (src/db/pool.js) é substituído por um client do pg-mem —
// BEGIN/COMMIT e set_config (usados por withTenantClient) já funcionam
// nativamente no pg-mem, então as rotas rodam de ponta a ponta sem precisar
// de Postgres real.

process.env.JWT_SECRET = 'segredo-de-teste';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { newDb } = require('pg-mem');

const { requireAuth, requirePermission } = require('../src/middleware/auth');
const { pool } = require('../src/db/pool');
const patientsRoutes = require('../src/routes/patients');
const agendaRoutes = require('../src/routes/agenda');
const financialRoutes = require('../src/routes/financial');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

function token(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

async function main() {
  console.log('\n== Teste: requireAuth (unitário, sem HTTP) ==');
  {
    const req = { headers: {} };
    let calledNext = false, status = null, body = null;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    requireAuth(req, res, () => { calledNext = true; });
    assert(calledNext === false && status === 401, 'sem header Authorization, retorna 401 e não chama next()');
    assert(body.error === 'Token ausente.', 'mensagem de erro é "Token ausente."');
  }
  {
    const req = { headers: { authorization: 'Bearer token-invalido' } };
    let calledNext = false, status = null;
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    requireAuth(req, res, () => { calledNext = true; });
    assert(calledNext === false && status === 401, 'token que não decodifica retorna 401');
  }
  {
    const expired = jwt.sign({ sub: 'u1', clinicId: 'c1' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${expired}` } };
    let calledNext = false, status = null;
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    requireAuth(req, res, () => { calledNext = true; });
    assert(calledNext === false && status === 401, 'token expirado retorna 401');
  }
  {
    const valid = token({ sub: 'user-1', clinicId: 'clinic-1', permissions: ['patients:view'] });
    const req = { headers: { authorization: `Bearer ${valid}` } };
    let calledNext = false;
    const res = {};
    requireAuth(req, res, () => { calledNext = true; });
    assert(calledNext === true, 'token válido chama next()');
    assert(req.auth.userId === 'user-1' && req.auth.clinicId === 'clinic-1', 'req.auth é populado com userId/clinicId do payload');
    assert(Array.isArray(req.auth.permissions) && req.auth.permissions.includes('patients:view'), 'req.auth.permissions vem do payload');
  }
  {
    const valid = token({ sub: 'user-1', clinicId: 'clinic-1' });
    const req = { headers: { authorization: `Bearer ${valid}` } };
    requireAuth(req, {}, () => {});
    assert(Array.isArray(req.auth.permissions) && req.auth.permissions.length === 0, 'payload sem "permissions" vira array vazio, não undefined');
  }

  console.log('\n== Teste: requirePermission (unitário, sem HTTP) ==');
  {
    const req = { auth: { permissions: ['financial:view'] } };
    let calledNext = false, status = null, body = null;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    requirePermission('financial', 'view_financial_values')(req, res, () => { calledNext = true; });
    assert(calledNext === false && status === 403, 'permissão insuficiente (mesmo módulo, ação diferente) retorna 403');
    assert(body.error === 'Permissão negada: financial:view_financial_values', 'mensagem cita a permissão exata que faltou');
  }
  {
    const req = { auth: { permissions: ['financial:view_financial_values'] } };
    let calledNext = false;
    requirePermission('financial', 'view_financial_values')(req, {}, () => { calledNext = true; });
    assert(calledNext === true, 'permissão presente chama next()');
  }
  {
    const req = {};
    let calledNext = false, status = null;
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    requirePermission('patients', 'view')(req, res, () => { calledNext = true; });
    assert(calledNext === false && status === 403, 'req.auth ausente (requireAuth não rodou) é tratado como sem permissão, não como crash');
  }

  console.log('\n== Teste: rotas reais montadas em HTTP (patients, agenda, financial) ==');

  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid', returns: 'uuid',
    implementation: () => crypto.randomUUID(), impure: true,
  });
  let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  schema = schema.replace(/CREATE EXTENSION.*\n/g, '');
  db.public.none(schema);
  const { Client } = db.adapters.createPg();
  const pgMemClient = new Client();
  await pgMemClient.connect();

  const originalConnect = pool.connect.bind(pool);
  pool.connect = async () => ({
    query: (...args) => pgMemClient.query(...args),
    release: () => {},
  });

  const app = express();
  app.use(express.json());
  app.use('/api/patients', patientsRoutes);
  app.use('/api/agenda', agendaRoutes);
  app.use('/api/financial', financialRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clinicId = crypto.randomUUID();
  const professionalId = crypto.randomUUID();

  async function get(urlPath, permissions) {
    const headers = {};
    if (permissions !== undefined) {
      headers.Authorization = `Bearer ${token({ sub: 'user-1', clinicId, permissions })}`;
    }
    const res = await fetch(`${baseUrl}${urlPath}`, { headers });
    let json = null;
    try { json = await res.json(); } catch (_e) { /* corpo vazio */ }
    return { status: res.status, json };
  }

  try {
    // --- patients.js: GET / exige patients:view ---
    let res = await get('/api/patients');
    assert(res.status === 401, 'GET /api/patients sem token retorna 401');

    res = await get('/api/patients', []);
    assert(res.status === 403, 'GET /api/patients com token mas sem "patients:view" retorna 403');

    res = await get('/api/patients', ['patients:view']);
    assert(res.status === 200 && Array.isArray(res.json), 'GET /api/patients com "patients:view" passa pelo middleware e chega no handler (200, lista vazia)');

    // --- agenda.js: GET /professional/:id exige agenda:view ---
    res = await get(`/api/agenda/professional/${professionalId}?date=2026-01-01`);
    assert(res.status === 401, 'GET /api/agenda/professional/:id sem token retorna 401');

    res = await get(`/api/agenda/professional/${professionalId}?date=2026-01-01`, ['patients:view']);
    assert(res.status === 403, 'GET /api/agenda/professional/:id com permissão de outro módulo retorna 403');

    res = await get(`/api/agenda/professional/${professionalId}?date=2026-01-01`, ['agenda:view']);
    assert(res.status === 200 && Array.isArray(res.json), 'GET /api/agenda/professional/:id com "agenda:view" chega no handler (200)');

    // --- financial.js: duas rotas do MESMO arquivo, permissões diferentes ---
    // /accounts-payable exige 'financial:view'; /dashboard exige
    // 'financial:view_financial_values' -- exatamente o tipo de diferença
    // sutil que um copy-paste entre rotas do mesmo arquivo poderia quebrar.
    res = await get('/api/financial/accounts-payable', ['financial:view']);
    assert(res.status === 200, 'GET /api/financial/accounts-payable com "financial:view" retorna 200');

    res = await get('/api/financial/dashboard', ['financial:view']);
    assert(res.status === 403, 'GET /api/financial/dashboard com só "financial:view" (permissão da rota vizinha) retorna 403 -- não é aceita por engano');

    res = await get('/api/financial/dashboard', ['financial:view_financial_values']);
    assert(res.status === 200 && typeof res.json.currentBalance === 'number', 'GET /api/financial/dashboard com "financial:view_financial_values" retorna 200 com o resumo');
  } finally {
    server.close();
    pool.connect = originalConnect;
  }

  console.log('\nTodos os testes de route-auth.test.js passaram.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
