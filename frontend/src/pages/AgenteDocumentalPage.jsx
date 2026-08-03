// src/pages/AgenteDocumentalPage.jsx
import { AgentChat } from '../components/AgentChat';

const SUGGESTIONS = [
  'Quais assinaturas estão pendentes?',
  'Algum contrato vence nos próximos 30 dias?',
  'Tem fornecedor sem contrato assinado?',
  'Algum paciente tem foto clínica sem autorização de imagem?',
];

export function AgenteDocumentalPage() {
  return (
    <div>
      <h1>Agente Documental</h1>
      <AgentChat
        endpoint="/document-automation/agent/ask"
        subtitle="Assistente de contratos e termos — só lê o que já está no sistema, nunca decide ou assina sozinho."
        groundingNote="Minutas e sugestões deste agente não têm validade jurídica automática — revisão por profissional habilitado é sempre necessária."
        suggestions={SUGGESTIONS}
      />
    </div>
  );
}
