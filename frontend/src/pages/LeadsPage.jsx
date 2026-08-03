// src/pages/LeadsPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const STAGE_LABELS = {
  novo_lead: 'Novo lead',
  primeiro_contato: 'Primeiro contato',
  em_atendimento: 'Em atendimento',
  avaliacao_agendada: 'Avaliação agendada',
  avaliacao_confirmada: 'Avaliação confirmada',
  avaliacao_realizada: 'Avaliação realizada',
  orcamento_apresentado: 'Orçamento apresentado',
  em_negociacao: 'Em negociação',
  aguardando_decisao: 'Aguardando decisão',
  fechado: 'Fechado',
  perdido: 'Perdido',
  em_tratamento: 'Em tratamento',
  pos_tratamento: 'Pós-tratamento',
  reativacao: 'Reativação',
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);
const CLOSED_STAGES = ['fechado', 'perdido'];

function stageBadgeClass(stage) {
  if (['fechado', 'em_tratamento', 'pos_tratamento'].includes(stage)) return 'badge badge-success';
  if (stage === 'perdido') return 'badge badge-alert';
  if (['novo_lead', 'primeiro_contato', 'em_atendimento'].includes(stage)) return 'badge badge-neutral';
  return 'badge badge-warn';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

const emptyForm = { fullName: '', phone: '', email: '', procedureInterest: '', source: '', potentialValue: '' };

export function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [leadRows, funnelSummary] = await Promise.all([
        api.get('/leads'),
        api.get('/leads/funnel'),
      ]);
      setLeads(leadRows);
      setFunnel(funnelSummary);
    } catch (err) {
      setPageError('Não foi possível carregar o CRM agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function updateField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/leads', {
        ...form,
        potentialValue: form.potentialValue ? Number(form.potentialValue) : null,
      });
      setForm(emptyForm);
      setShowForm(false);
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o lead.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangeStage(lead, newStage) {
    setActionError(null);
    let lossReason;
    if (newStage === 'perdido') {
      lossReason = window.prompt('Motivo da perda (obrigatório):', '') || '';
      if (lossReason.trim() === '') return;
    }
    try {
      await api.post(`/leads/${lead.id}/status`, { status: newStage, lossReason });
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mudar a etapa do lead.');
    }
  }

  const stagesWithLeads = funnel ? STAGE_ORDER.filter((s) => funnel.byStage[s]?.count > 0) : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>CRM de Leads</h1>
          <p style={{ color: 'var(--muted)' }}>Funil comercial — do primeiro contato até o fechamento.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Novo lead'}
        </button>
      </div>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      {funnel && (
        <div className="card-grid">
          {stagesWithLeads.map((stage) => (
            <div className="stat-card" key={stage}>
              <div className="stat-label">{STAGE_LABELS[stage]}</div>
              <div className="stat-value mono">{funnel.byStage[stage].count}</div>
              {funnel.byStage[stage].potentialTotal > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {formatCurrency(funnel.byStage[stage].potentialTotal)} em potencial
                </div>
              )}
            </div>
          ))}
          <div className="stat-card">
            <div className="stat-label">Taxa de conversão</div>
            <div className="stat-value mono">
              {funnel.conversionRate === null ? '—' : `${Math.round(funnel.conversionRate * 100)}%`}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Cadastrar lead</h3>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="card-grid" style={{ marginBottom: 0 }}>
              <div className="field">
                <label htmlFor="fullName">Nome</label>
                <input id="fullName" required value={form.fullName} onChange={updateField('fullName')} />
              </div>
              <div className="field">
                <label htmlFor="phone">Telefone</label>
                <input id="phone" value={form.phone} onChange={updateField('phone')} placeholder="(00) 00000-0000" />
              </div>
              <div className="field">
                <label htmlFor="procedureInterest">Procedimento de interesse</label>
                <input id="procedureInterest" value={form.procedureInterest} onChange={updateField('procedureInterest')} />
              </div>
              <div className="field">
                <label htmlFor="source">Origem</label>
                <input id="source" value={form.source} onChange={updateField('source')} placeholder="Instagram, indicação, Google…" />
              </div>
              <div className="field">
                <label htmlFor="potentialValue">Valor potencial (R$)</label>
                <input id="potentialValue" type="number" min="0" step="0.01" value={form.potentialValue} onChange={updateField('potentialValue')} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginTop: 6 }}>
              {submitting ? 'Salvando…' : 'Salvar lead'}
            </button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state"><p>Carregando…</p></div>
        ) : leads.length === 0 ? (
          <div className="empty-state">
            <h2>Nenhum lead cadastrado</h2>
            <p>Cadastre o primeiro lead do funil comercial.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>Procedimento</th>
                <th>Valor potencial</th>
                <th>Etapa</th>
                <th>Mudar etapa</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.full_name}</td>
                  <td className="mono">{lead.phone || '—'}</td>
                  <td>{lead.procedure_interest || '—'}</td>
                  <td className="mono">{formatCurrency(lead.potential_value)}</td>
                  <td><span className={stageBadgeClass(lead.status)}>{STAGE_LABELS[lead.status] || lead.status}</span></td>
                  <td>
                    {CLOSED_STAGES.includes(lead.status) ? (
                      <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>Etapa final</span>
                    ) : (
                      <select value="" onChange={(e) => { if (e.target.value) handleChangeStage(lead, e.target.value); }}>
                        <option value="">Selecionar…</option>
                        {STAGE_ORDER.filter((s) => s !== lead.status).map((s) => (
                          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
