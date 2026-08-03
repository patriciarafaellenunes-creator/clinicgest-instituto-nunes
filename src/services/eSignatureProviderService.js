// src/services/eSignatureProviderService.js
//
// Integração real com a Clicksign (API v3 — API de Envelope). Diferente do
// resto do projeto, este arquivo não tem teste automatizado: depende de
// uma conta real na Clicksign, que não existe neste ambiente de
// desenvolvimento. A forma das chamadas (endpoints, formato JSON:API,
// nomes de campos) foi conferida contra a documentação oficial em
// developers.clicksign.com em julho de 2026 — mas o comportamento real só
// se confirma rodando contra a conta de verdade.
//
// Fluxo da Clicksign (documentado em "Criação e Configuração do Envelope"):
//   1. Criar um envelope (a "pasta" que agrupa tudo)
//   2. Adicionar o documento (PDF em base64) ao envelope
//   3. Adicionar o(s) signatário(s)
//   4. Criar um "requisito de qualificação" (liga o signatário ao documento,
//      dizendo que ação ele precisa tomar — "sign")
//   5. Criar um "requisito de autenticação" (como a identidade dele é
//      verificada — aqui usando e-mail, o método mais simples)
//   6. Ativar o envelope (muda o status de "draft" pra "running")
//   7. Disparar a notificação (a Clicksign manda o link de assinatura por
//      e-mail pro signatário)

const CLICKSIGN_BASE_URL = process.env.CLICKSIGN_BASE_URL || 'https://sandbox.clicksign.com/api/v3';
// Para produção, depois de testar no sandbox: https://app.clicksign.com/api/v3

class ESignatureProviderError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function clicksignRequest(path, { method = 'GET', body } = {}) {
  const token = process.env.CLICKSIGN_ACCESS_TOKEN;
  if (!token) throw new ESignatureProviderError('CLICKSIGN_ACCESS_TOKEN não configurada no .env.');

  const response = await fetch(`${CLICKSIGN_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, // a documentação da Clicksign tem exemplos inconsistentes (com e sem "Bearer") — este formato é o usado no exemplo mais recente da página inicial deles
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.errors?.[0]?.detail || response.statusText;
    throw new ESignatureProviderError(`Clicksign retornou erro (${response.status}): ${detail}`, data);
  }
  return data;
}

/**
 * Envia um documento pra assinatura na Clicksign: cria o envelope, sobe o
 * PDF, cadastra cada signatário, liga cada um ao documento (requisitos de
 * qualificação + autenticação por e-mail), ativa o envelope e dispara a
 * notificação por e-mail. Retorna o id do envelope (guardar isso no seu
 * banco pra saber depois qual documento local corresponde a qual envelope
 * na Clicksign).
 *
 * @param {Buffer} pdfBytes - o PDF gerado por pdfService.generateDocumentPdf
 * @param {string} envelopeName - nome do envelope na Clicksign (aparece no painel deles)
 * @param {Array<{name: string, email: string}>} signers - lista de signatários
 */
async function sendDocumentForSignature(pdfBytes, envelopeName, signers) {
  if (!signers || signers.length === 0) {
    throw new ESignatureProviderError('É preciso pelo menos um signatário.');
  }

  // 1. Criar o envelope
  const envelopeResponse = await clicksignRequest('/envelopes', {
    method: 'POST',
    body: { data: { type: 'envelopes', attributes: { name: envelopeName, locale: 'pt-BR' } } },
  });
  const envelopeId = envelopeResponse.data.id;

  // 2. Adicionar o documento (a Clicksign exige o PDF como base64, com o prefixo data:application/pdf;base64,)
  const base64Pdf = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;
  const documentResponse = await clicksignRequest(`/envelopes/${envelopeId}/documents`, {
    method: 'POST',
    body: {
      data: {
        type: 'documents',
        attributes: { filename: `${envelopeName}.pdf`, content_base64: base64Pdf },
      },
    },
  });
  const documentId = documentResponse.data.id;

  // 3-5. Para cada signatário: criar o signatário, depois os dois requisitos (qualificação + autenticação)
  const createdSigners = [];
  for (const signer of signers) {
    const signerResponse = await clicksignRequest(`/envelopes/${envelopeId}/signers`, {
      method: 'POST',
      body: {
        data: {
          type: 'signers',
          attributes: {
            name: signer.name,
            email: signer.email,
            communicate_events: { signature_request: 'email', signature_reminder: 'email', document_signed: 'email' },
          },
        },
      },
    });
    const signerId = signerResponse.data.id;

    await clicksignRequest(`/envelopes/${envelopeId}/requirements`, {
      method: 'POST',
      body: {
        data: {
          type: 'requirements',
          attributes: { action: 'agree', role: 'sign' },
          relationships: {
            document: { data: { type: 'documents', id: documentId } },
            signer: { data: { type: 'signers', id: signerId } },
          },
        },
      },
    });

    await clicksignRequest(`/envelopes/${envelopeId}/requirements`, {
      method: 'POST',
      body: {
        data: {
          type: 'requirements',
          attributes: { action: 'provide_evidence', auth: 'email' },
          relationships: {
            document: { data: { type: 'documents', id: documentId } },
            signer: { data: { type: 'signers', id: signerId } },
          },
        },
      },
    });

    createdSigners.push({ signerId, name: signer.name, email: signer.email });
  }

  // 6. Ativar o envelope — sem isso, nada é enviado
  await clicksignRequest(`/envelopes/${envelopeId}`, {
    method: 'PATCH',
    body: { data: { id: envelopeId, type: 'envelopes', attributes: { status: 'running' } } },
  });

  // 7. Disparar a notificação por e-mail pra todo mundo
  await clicksignRequest(`/envelopes/${envelopeId}/notifications`, {
    method: 'POST',
    body: { data: { type: 'notifications', attributes: {} } },
  });

  return { envelopeId, documentId, signers: createdSigners };
}

module.exports = { sendDocumentForSignature, ESignatureProviderError, CLICKSIGN_BASE_URL };
