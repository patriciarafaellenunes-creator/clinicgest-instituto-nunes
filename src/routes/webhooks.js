// src/routes/webhooks.js
//
// Rota PÚBLICA (sem requireAuth) — a Clicksign não tem como mandar um JWT
// seu. A proteção aqui é a validação HMAC: só aceitamos o aviso se ele vier
// assinado com o segredo que a Clicksign gerou quando você cadastrou o
// webhook (ver passo 4 do guia). Nunca confie no conteúdo do aviso sem essa
// validação — qualquer um poderia mandar um POST fingindo ser a Clicksign.

const express = require('express');
const crypto = require('crypto');
const { withTenantClient, pool } = require('../db/pool');
const documentsService = require('../services/documentsService');

const router = express.Router();

/**
 * Confere o cabeçalho Content-Hmac que a Clicksign manda. Segundo a
 * documentação deles, é sha256(corpo_da_requisição + segredo) — CONFIRME
 * isso comparando com o valor real na primeira vez que testar (ver passo 6
 * do guia); se não bater, o suporte da Clicksign confirma o método exato.
 */
function verifyClicksignSignature(rawBody, headerValue) {
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET;
  if (!secret) throw new Error('CLICKSIGN_WEBHOOK_SECRET não configurada no .env.');
  if (!headerValue) return false;

  const expectedHash = crypto.createHash('sha256').update(rawBody + secret).digest('hex');
  const received = headerValue.replace('sha256=', '');

  const expectedBuffer = Buffer.from(expectedHash);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

router.post('/clicksign', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = req.body.toString('utf8');
    const signatureHeader = req.headers['content-hmac'];

    if (!verifyClicksignSignature(rawBody, signatureHeader)) {
      console.warn('Webhook da Clicksign com assinatura inválida — ignorado.');
      return res.status(401).json({ error: 'Assinatura inválida.' });
    }

    const payload = JSON.parse(rawBody);
    console.log('Webhook Clicksign recebido:', JSON.stringify(payload).slice(0, 500));

    const eventName = payload?.event?.name;
    const envelopeId = payload?.data?.envelope?.id || payload?.envelope?.id;

    if (!envelopeId) {
      return res.status(200).json({ received: true, note: 'Evento sem envelope reconhecido — só logado.' });
    }

    const lookup = await pool.query(`SELECT id, clinic_id FROM documents WHERE external_signature_id = $1`, [envelopeId]);
    const documentRow = lookup.rows[0];
    if (!documentRow) {
      return res.status(200).json({ received: true, note: 'Envelope não corresponde a nenhum documento conhecido.' });
    }

    if (eventName === 'sign' || eventName === 'auto_close') {
      await withTenantClient(documentRow.clinic_id, async (client) => {
        const document = await documentsService.getDocumentWithSignatures(client, documentRow.clinic_id, documentRow.id);
        const pendingSignature = document.signatures.find((s) => s.status === 'pendente');
        if (pendingSignature) {
          await documentsService.recordSignature(client, {
            documentId: document.id,
            signatureId: pendingSignature.id,
            clinicId: documentRow.clinic_id,
            userId: null,
            signatureMethod: 'clicksign',
            ipAddress: payload?.event?.data?.signers?.[0]?.ip || null,
            deviceInfo: 'Clicksign (assinatura remota)',
          });
        }
      });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro processando webhook da Clicksign:', err);
    res.status(200).json({ received: true, error: 'internal_error_logged' });
  }
});

module.exports = router;
