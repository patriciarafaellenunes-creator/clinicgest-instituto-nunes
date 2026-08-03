// src/components/AgentChat.jsx
//
// Componente compartilhado pelos dois agentes (financeiro e documental) —
// mesmo formato de pergunta/resposta, mesma garantia de que toda resposta
// vem de uma ferramenta real (por isso cada resposta mostra quais dados
// foram consultados, não é uma caixa-preta).

import { useState } from 'react';
import { api, ApiError } from '../api/client';

export function AgentChat({ endpoint, subtitle, groundingNote, suggestions }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const [openLog, setOpenLog] = useState(null);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || asking) return;
    setError(null);
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setAsking(true);
    try {
      const result = await api.post(endpoint, { question: text });
      setMessages((prev) => [...prev, { role: 'assistant', text: result.answer, toolCallLog: result.toolCallLog }]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Não foi possível consultar o agente.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'assistant', text: null, errorText: msg }]);
    } finally {
      setAsking(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    ask();
  }

  const isConfigError = error && /ANTHROPIC_API_KEY/i.test(error);

  return (
    <div>
      <p style={{ color: 'var(--muted)', marginBottom: 6 }}>{subtitle}</p>
      <p style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 20 }}>{groundingNote}</p>

      {isConfigError && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          Este agente ainda não está ativo: falta configurar a chave da API da Anthropic (<code>ANTHROPIC_API_KEY</code>) no arquivo <code>.env</code> do servidor.
          Isso não é algo que se resolve pela tela — peça para quem cuida da parte técnica configurar a chave uma vez, e o agente passa a responder normalmente.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, minHeight: 200, maxHeight: 440, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 ? (
          <div style={{ color: 'var(--muted)' }}>
            <p style={{ marginBottom: 10 }}>Pergunte algo, ou tente um exemplo:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map((s) => (
                <button key={s} type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px', fontSize: 12.5 }}
                  onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div style={{
                background: m.role === 'user' ? 'var(--brand-soft)' : 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, whiteSpace: 'pre-wrap',
              }}>
                {m.errorText ? <span style={{ color: 'var(--alert)' }}>{m.errorText}</span> : m.text}
              </div>
              {m.toolCallLog && m.toolCallLog.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <button type="button" className="btn" style={{ background: 'transparent', border: 'none', padding: '2px 4px', fontSize: 11.5, color: 'var(--muted)', textDecoration: 'underline' }}
                    onClick={() => setOpenLog(openLog === i ? null : i)}>
                    {openLog === i ? 'Ocultar' : 'Ver'} dados consultados ({m.toolCallLog.length})
                  </button>
                  {openLog === i && (
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {m.toolCallLog.map((t, ti) => (
                        <div key={ti} className="mono" style={{ fontSize: 11, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 3 }}>{t.tool}{Object.keys(t.input || {}).length > 0 ? ` (${JSON.stringify(t.input)})` : ''}</div>
                          <div style={{ color: 'var(--muted)', maxHeight: 100, overflowY: 'auto' }}>{JSON.stringify(t.result)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {asking && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Consultando…</div>}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Digite sua pergunta…" style={{ flex: 1 }} disabled={asking} />
        <button className="btn btn-primary" type="submit" disabled={asking || !question.trim()}>Perguntar</button>
      </form>
    </div>
  );
}
