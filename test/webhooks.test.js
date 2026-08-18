// test/webhooks.test.js
//
// Cobre a rota pública /api/webhooks/clicksign. Diferente dos outros
// arquivos em test/, aqui o alvo é a camada HTTP (Express), não um service
// isolado — é a única rota da API sem requireAuth, então a validação de
// assinatura HMAC é a única linha de defesa e precisa estar coberta.
//
// pool.query/pool.connect (src/db/pool.js) são substituídos por stubs neste
// arquivo — não há Postgres real disponível aqui. A rota só chega a usá-los
// depois que a assinatura já foi validada, então isso não enfraquece o
// teste da parte que mais importa (a validação em si).

process.env.CLICKSIGN_WEBHOOK_SECRET = 'segredo-de-teste';

const crypto = require('crypto');
const express = require('express');
const webhooksRoutes = require('../src/routes/webhooks');
const { pool } = require('../src/db/pool');
const documentsService = require('../src/services/documentsService');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

function sign(body, secret = process.env.CLICKSIGN_WEBHOOK_SECRET) {
  return 'sha256=' + crypto.createHash('sha256').update(body + secret).digest('hex');
}

function startServer() {
  const app = express();
  app.use('/api/webhooks', webhooksRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function post(baseUrl, body, headers) {
  const res = await fetch(`${baseUrl}/api/webhooks/clicksign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  console.log('\n== Teste: verifyClicksignSignature (unitário) ==');
  const { verifyClicksignSignature } = webhooksRoutes;
  const body = JSON.stringify({ event: { name: 'sign' } });

  assert(verifyClicksignSignature(body, sign(body)) === true, 'assinatura correta é aceita');
  assert(verifyClicksignSignature(body, sign(body, 'segredo-errado')) === false, 'assinatura com segredo errado é rejeitada');
  assert(verifyClicksignSignature(body + 'adulterado', sign(body)) === false, 'corpo adulterado invalida a assinatura');
  assert(verifyClicksignSignature(body, null) === false, 'header ausente é rejeitado');
  assert(verifyClicksignSignature(body, 'sha256=abc') === false, 'assinatura de tamanho errado é rejeitada sem lançar exceção');

  let missingSecretThrew = false;
  const savedSecret = process.env.CLICKSIGN_WEBHOOK_SECRET;
  delete process.env.CLICKSIGN_WEBHOOK_SECRET;
  try {
    verifyClicksignSignature(body, sign(body, savedSecret));
  } catch (err) {
    missingSecretThrew = true;
  }
  process.env.CLICKSIGN_WEBHOOK_SECRET = savedSecret;
  assert(missingSecretThrew, 'sem CLICKSIGN_WEBHOOK_SECRET configurada, lança erro em vez de aceitar tudo');

  console.log('\n== Teste: rota POST /api/webhooks/clicksign (HTTP) ==');
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  const originalGetDoc = documentsService.getDocumentWithSignatures;
  const originalRecordSig = documentsService.recordSignature;

  try {
    // 1) Assinatura inválida -> 401, e nunca chega a tocar no banco.
    let dbTouched = false;
    pool.query = async (...args) => { dbTouched = true; return originalQuery(...args); };

    let res = await post(baseUrl, JSON.stringify({ event: { name: 'sign' } }), { 'Content-Hmac': 'sha256=assinaturaerrada' });
    assert(res.status === 401, 'assinatura inválida retorna 401');
    assert(dbTouched === false, 'assinatura inválida não gera nenhuma consulta ao banco');

    // 2) Sem header nenhum -> 401 também.
    res = await post(baseUrl, JSON.stringify({ event: { name: 'sign' } }), {});
    assert(res.status === 401, 'requisição sem header Content-Hmac retorna 401');

    // 3) Assinatura válida, payload sem envelope reconhecível -> 200, sem tocar no banco.
    dbTouched = false;
    const noEnvelopeBody = JSON.stringify({ event: { name: 'update' } });
    res = await post(baseUrl, noEnvelopeBody, { 'Content-Hmac': sign(noEnvelopeBody) });
    assert(res.status === 200, 'assinatura válida sem envelopeId retorna 200');
    assert(dbTouched === false, 'payload sem envelopeId não consulta o banco');

    // 4) Assinatura válida, envelope não encontrado no banco -> 200 "não corresponde".
    pool.query = async () => ({ rows: [] });
    const unknownEnvelopeBody = JSON.stringify({ event: { name: 'sign' }, envelope: { id: 'env-desconhecido' } });
    res = await post(baseUrl, unknownEnvelopeBody, { 'Content-Hmac': sign(unknownEnvelopeBody) });
    assert(res.status === 200, 'envelope desconhecido retorna 200 (não é erro)');
    assert(/não corresponde/.test(res.json.note || ''), 'resposta indica que o envelope não corresponde a documento conhecido');

    // 5) Assinatura válida, envelope conhecido, evento "sign" -> grava a assinatura pendente.
    const clinicId = 'clinic-1';
    const documentId = 'doc-1';
    pool.query = async () => ({ rows: [{ id: documentId, clinic_id: clinicId }] });
    pool.connect = async () => ({ query: async () => ({ rows: [] }), release: () => {} });

    let recordedSignature = null;
    documentsService.getDocumentWithSignatures = async () => ({
      id: documentId,
      signatures: [{ id: 'sig-1', status: 'pendente', signer_name: 'Paciente Teste' }],
    });
    documentsService.recordSignature = async (client, args) => { recordedSignature = args; };

    const knownEnvelopeBody = JSON.stringify({
      event: { name: 'sign', data: { signers: [{ ip: '1.2.3.4' }] } },
      envelope: { id: 'env-conhecido' },
    });
    res = await post(baseUrl, knownEnvelopeBody, { 'Content-Hmac': sign(knownEnvelopeBody) });

    assert(res.status === 200, 'evento "sign" com envelope conhecido retorna 200');
    assert(recordedSignature !== null, 'assinatura pendente é registrada quando o evento é "sign"');
    assert(recordedSignature.signatureMethod === 'clicksign', 'assinatura é registrada com método "clicksign"');
    assert(recordedSignature.ipAddress === '1.2.3.4', 'IP do signatário do payload é propagado para o registro');

    documentsService.getDocumentWithSignatures = originalGetDoc;
    documentsService.recordSignature = originalRecordSig;

    // 6) Erro inesperado no processamento não deve vazar 500 -- webhook sempre responde 200
    //    (a Clicksign reenviaria em loop se recebesse erro).
    pool.query = async () => { throw new Error('falha simulada de conexão'); };
    const errorBody = JSON.stringify({ event: { name: 'sign' }, envelope: { id: 'env-x' } });
    res = await post(baseUrl, errorBody, { 'Content-Hmac': sign(errorBody) });
    assert(res.status === 200, 'erro interno durante o processamento ainda responde 200');
    assert(res.json.error === 'internal_error_logged', 'resposta sinaliza erro interno logado sem vazar detalhes');
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    documentsService.getDocumentWithSignatures = originalGetDoc;
    documentsService.recordSignature = originalRecordSig;
    server.close();
  }

  console.log('\nTodos os testes de webhooks.test.js passaram.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
