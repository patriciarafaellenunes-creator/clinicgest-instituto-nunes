# Guia de Integração — Assinatura Eletrônica Real e WhatsApp/E-mail

Estes são os dois últimos itens do briefing original que **não têm como
ser construídos e testados neste ambiente de desenvolvimento**, porque
dependem de contas e credenciais de serviços de terceiros (um provedor de
assinatura eletrônica, uma conta do WhatsApp Business, um serviço de
envio de e-mail). Diferente do resto do projeto — onde tudo foi construído
E testado, incluindo RLS contra um Postgres real —, isto aqui é um mapa de
como plugar cada peça, referenciando os pontos exatos do código que já
existem e estão prontos para receber essa integração.

**Nada neste documento foi executado ou testado.** É a continuação
necessária do trabalho, não trabalho concluído.

---

## 1. Assinatura eletrônica real

### O que já existe (Fase 2, documento 3)

- `documents` / `document_signatures` já modelam todo o ciclo: cada
  documento tem N signatários, cada um com `status` (pendente/assinado/
  recusado), `signature_method`, `ip_address`, `device_info`,
  `validation_code`.
- `documentsService.recordSignature(client, { documentId, signatureId,
  clinicId, userId, signatureMethod, ipAddress, deviceInfo })` — função que
  registra UMA assinatura e, quando todas as exigidas estão completas, trava
  o documento (`assertNotLocked`) automaticamente. **Este é o ponto de
  entrada que a integração real vai chamar** — não precisa mudar nada nele.
- `pdfService.generateDocumentPdf(...)` já gera o PDF do documento — é o
  artefato que precisa ser enviado ao provedor de assinatura.

### O que falta: dois caminhos possíveis

**Caminho A — Plataforma de assinatura como serviço** (recomendado para
começar: mais rápido de integrar, já cobre validade jurídica no Brasil via
MP 2.200-2/2001, mesmo sem certificado ICP-Brasil, para a maioria dos casos
de uso de clínica). Opções usadas no mercado brasileiro: Clicksign,
Autentique, D4Sign, ou internacionalmente DocuSign.

Fluxo:
1. `POST /api/documents/:id/send-for-signature` (rota nova) — gera o PDF
   via `pdfService`, envia pro provedor junto com a lista de signatários
   (nome, e-mail, `signer_role`), guarda o `externalDocumentId` retornado
   pelo provedor numa coluna nova (`documents.external_signature_id`,
   precisa de uma migração pequena).
2. O provedor manda o link de assinatura pro e-mail/WhatsApp de cada
   signatário — isso já é feature nativa da maioria desses serviços, não
   precisa reimplementar envio de e-mail para isso especificamente.
3. **Webhook de retorno**: `POST /api/webhooks/e-signature` (rota nova,
   pública, mas validando a assinatura HMAC do provedor no header — nunca
   confiar no payload sem validar). Quando o provedor avisa que um
   signatário assinou, o handler chama
   `documentsService.recordSignature(client, { documentId, signatureId,
   clinicId, userId: null, signatureMethod: 'plataforma_terceiro',
   ipAddress: payload.ip, deviceInfo: payload.device })` — reaproveitando a
   função que já existe e já está testada.
4. Quando o provedor avisa que TODOS assinaram, opcionalmente baixar o PDF
   assinado final (com carimbo de autenticidade do provedor) e substituir
   a referência armazenada.

Esboço do service (não testado):

```javascript
// src/services/eSignatureProviderService.js (A CRIAR)
async function sendForSignature(documentBytes, { signers, externalId }) {
  const response = await fetch('https://api.clicksign.com/v3/envelopes', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CLICKSIGN_API_KEY}` },
    body: /* multipart com o PDF + payload de signatarios */,
  });
  if (!response.ok) throw new Error('Falha ao enviar documento para assinatura.');
  return response.json(); // contem o id do envelope no provedor
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const expected = crypto.createHmac('sha256', process.env.CLICKSIGN_WEBHOOK_SECRET)
    .update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

**Caminho B — Certificado ICP-Brasil direto** (mais robusto juridicamente,
mais complexo de integrar: exige lidar com certificado A1/A3, assinatura
CAdES/PAdES, geralmente via uma biblioteca ou serviço intermediário como a
API do Serpro ou de um Prestador de Serviços de Confiança credenciado).
Vale considerar depois que o volume de documentos justificar o custo e a
complexidade adicional — para a maioria dos termos de consentimento de
clínica, o Caminho A já atende ao que a MP 2.200-2 exige.

### Checklist de implementação

- [ ] Escolher provedor e criar conta (fora deste projeto)
- [ ] `ALTER TABLE documents ADD COLUMN external_signature_id TEXT;`
- [ ] Criar `src/services/eSignatureProviderService.js`
- [ ] Criar rota `POST /api/documents/:id/send-for-signature`
- [ ] Criar rota pública `POST /api/webhooks/e-signature` com validação HMAC
- [ ] Testar com o ambiente sandbox do provedor antes de produção
- [ ] Atualizar `documentAutomationService` para, opcionalmente, já enviar
      pro provedor automaticamente quando um documento é gerado pela
      automação (`generateRequiredDocumentsForPlan`)

---

## 2. WhatsApp e e-mail para lembretes automáticos

### O que já existe

- `notifications` (schema) e `documentAutomationService.notifyExpiringContracts`
  já criam notificações **dentro do sistema** (in-app), com idempotência
  (não duplica enquanto a anterior não foi lida).
- As automações do briefing (lembrete de consulta 24h antes, cobrança de
  parcela vencendo, alerta de estoque mínimo) têm toda a lógica de
  "quando disparar" já modelada nos services correspondentes
  (`agendaService`, `financialService.getOverdueReceivables`,
  `inventoryService.getLowStockItems`) — falta só o canal de envio externo.

### O que falta: canal de envio + agendador

**Canal de envio** — dois serviços novos, sem dependência um do outro:

```javascript
// src/services/whatsappService.js (A CRIAR)
// Usando a API oficial do WhatsApp Business (Meta Cloud API) — outras
// opcoes: Twilio (mais simples de comecar, custo maior por mensagem) ou um
// BSP brasileiro (Z-API, Take Blip).
async function sendWhatsAppMessage(toPhone, templateName, params) {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'template',
        template: { name: templateName, language: { code: 'pt_BR' }, components: params },
      }),
    }
  );
  if (!response.ok) throw new Error('Falha ao enviar WhatsApp.');
  return response.json();
}
```

```javascript
// src/services/emailService.js (A CRIAR)
// Usando Resend (API simples) — alternativas: AWS SES (mais barato em
// volume, mais configuracao), SendGrid.
async function sendEmail({ to, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
  });
  if (!response.ok) throw new Error('Falha ao enviar e-mail.');
  return response.json();
}
```

**Atenção com o WhatsApp especificamente**: a Meta exige que mensagens
iniciadas pela empresa (não em resposta a uma mensagem do paciente) usem
**templates pré-aprovados** — não dá para mandar texto livre num lembrete
automático. Os templates (ex: "Lembrete de consulta") precisam ser
cadastrados e aprovados no Meta Business Manager antes de usar em produção
— isso é um passo manual, fora do código.

**Agendador** — hoje nada no sistema roda periodicamente sozinho; toda
automação existente é disparada por uma ação do usuário (aprovar um plano,
por exemplo) ou por uma chamada manual a um endpoint
(`POST /api/document-automation/contracts/notify-expiring`). Pra lembretes
de verdade (24h antes da consulta, por exemplo), é preciso algo rodando em
intervalo:

```javascript
// src/jobs/reminderJob.js (A CRIAR) — rodar via node-cron, ou via um
// scheduler externo (cron do sistema operacional, GitHub Actions
// agendado, ou um servico como Render Cron Jobs) chamando um endpoint
// protegido por uma chave de servico.
const cron = require('node-cron');

cron.schedule('0 * * * *', async () => { // a cada hora
  // Para cada clinica ativa: buscar agendamentos nas proximas 24-25h,
  // enviar WhatsApp/e-mail usando os dados ja existentes em agendaService.
});
```

### Checklist de implementação

- [ ] Criar conta WhatsApp Business + obter `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_ID`
- [ ] Cadastrar e aprovar templates de mensagem no Meta Business Manager
- [ ] Criar conta no provedor de e-mail escolhido + verificar domínio de envio
- [ ] Criar `src/services/whatsappService.js` e `src/services/emailService.js`
- [ ] Decidir estratégia de agendamento (node-cron dentro do processo vs.
      scheduler externo chamando um endpoint) — scheduler externo é mais
      robusto para múltiplas instâncias do servidor rodando ao mesmo tempo
- [ ] Conectar aos pontos de automação já existentes: lembrete de consulta
      (`agendaService`), cobrança de parcela (`financialService.
      getOverdueReceivables`), estoque mínimo (`inventoryService.
      getLowStockItems`), vencimento de contrato (já parcialmente pronto
      em `documentAutomationService.notifyExpiringContracts`, só falta
      trocar/complementar a notificação in-app pelo envio externo)
- [ ] Testar em sandbox de cada provedor antes de habilitar em produção

---

## Por que isso ficou como guia, não como código

Todo o resto deste projeto foi construído com teste real por trás — 23
suítes automatizadas no backend, mais um Postgres real instalado neste
ambiente especificamente para validar RLS e o frontend de ponta a ponta.
Essas duas integrações finais dependem de contas em serviços de terceiros
(WhatsApp Business, um provedor de assinatura, um provedor de e-mail) que
exigem cadastro, aprovação e credenciais que não existem neste ambiente de
desenvolvimento — e não faria sentido escrever código não verificável
apresentando-o como testado. Este guia é o material para a pessoa
responsável (você, ou quem for continuar o projeto) plugar essas peças
quando as contas estiverem prontas, com os pontos de entrada exatos no
código já indicados.
