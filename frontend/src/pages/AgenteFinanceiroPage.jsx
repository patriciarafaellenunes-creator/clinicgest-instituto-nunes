// src/pages/AgenteFinanceiroPage.jsx
import { AgentChat } from '../components/AgentChat';

const SUGGESTIONS = [
  'Qual é a projeção de caixa para os próximos 30 dias?',
  'Quais pacientes estão inadimplentes?',
  'Como está o funil de leads este mês?',
  'Tem algum item de estoque no mínimo?',
];

export function AgenteFinanceiroPage() {
  return (
    <div>
      <h1>Agente de IA Financeiro</h1>
      <AgentChat
        endpoint="/agent/ask"
        subtitle="Diretor financeiro virtual — responde só com dados reais do sistema, nunca estima."
        groundingNote="Não substitui contador ou advogado. Não tem permissão para excluir, alterar ou movimentar nada — apenas ler e explicar."
        suggestions={SUGGESTIONS}
      />
    </div>
  );
}
