// scripts/dev-server-fake-db.js
//
// SÓ PARA TESTAR O FRONTEND NO NAVEGADOR NESTE AMBIENTE DE DESENVOLVIMENTO,
// ONDE NÃO HÁ UM POSTGRES REAL DISPONÍVEL. Sobe a API real (src/index.js)
// mas troca o módulo 'pg' por um Postgres simulado em memória (pg-mem) —
// o mesmo simulador usado nos 24 testes automatizados do backend, aplicando
// o schema real (02-schema-mvp.sql). NUNCA use isso em produção: os dados
// somem quando o processo termina, e não há Row-Level Security nenhuma
// (pg-mem não implementa RLS — ver nota em 03-row-level-security.sql).
//
// Depois de subir, cria uma clínica de teste, um profissional e um paciente
// de exemplo, e imprime um e-mail/senha prontos pra login na tela.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { newDb } = require('pg-mem');

const db = newDb({ autoCreateForeignKeyIndices: true });
db.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', implementation: () => randomUUID(), impure: true });

let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
schema = schema.replace(/CREATE EXTENSION.*\n/g, '');
db.public.none(schema);

const pgMemAdapter = db.adapters.createPg();

// Faz qualquer `require('pg')` (usado em src/db/pool.js) retornar o adaptador
// do pg-mem em vez do driver real — precisa acontecer ANTES de requerer
// src/index.js, que é quem carrega pool.js por baixo dos panos.
const pgModulePath = require.resolve('pg');
require.cache[pgModulePath] = {
  id: pgModulePath, filename: pgModulePath, loaded: true, exports: pgMemAdapter,
};

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-fake-db';
process.env.PORT = process.env.PORT || '3002';

const app = require('../src/index.js');

const OWNER_EMAIL = 'patricia@institutonunes.com.br';
const OWNER_PASSWORD = 'senha-de-teste-123';

async function seed() {
  const base = `http://localhost:${process.env.PORT}`;

  const bootstrapRes = await fetch(`${base}/api/auth/bootstrap-clinic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyLegalName: 'Instituto Nunes LTDA',
      clinicName: 'Instituto Nunes',
      unitName: 'Instituto Nunes',
      ownerFullName: 'Dra. Patrícia Nunes',
      ownerEmail: OWNER_EMAIL,
      ownerPassword: OWNER_PASSWORD,
    }),
  });
  if (!bootstrapRes.ok) throw new Error('Falha no bootstrap: ' + JSON.stringify(await bootstrapRes.json()));

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const { token } = await loginRes.json();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  await fetch(`${base}/api/professionals`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ fullName: 'Dra. Patrícia Nunes', professionalRole: 'dentista', councilRegistration: 'CRO-PR-00000' }),
  });
  await fetch(`${base}/api/professionals`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ fullName: 'Dr. Convidado', professionalRole: 'dentista' }),
  });
  await fetch(`${base}/api/patients`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ fullName: 'Marina Costa', cpf: '11122233344', phone: '41998112233', email: 'marina@email.com' }),
  });
  await fetch(`${base}/api/procedures`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Retorno', defaultPrice: 0 }),
  });
  await fetch(`${base}/api/procedures`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ name: 'Avaliação', defaultPrice: 150 }),
  });

  console.log('\n=== Banco de teste (em memória) pronto para uso no navegador ===');
  console.log(`Login:  ${OWNER_EMAIL}`);
  console.log(`Senha:  ${OWNER_PASSWORD}`);
  console.log('Já criados: 2 profissionais, 1 paciente (Marina Costa), 2 procedimentos.');
  console.log('Lembrete: isso é só para teste visual — nada aqui é permanente.\n');
}

const server = app.listen(process.env.PORT, () => {
  console.log(`API (banco fake em memória) rodando em http://localhost:${process.env.PORT}`);
  seed().catch((err) => { console.error('Erro ao popular dados de teste:', err); server.close(); process.exit(1); });
});
