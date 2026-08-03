// src/pages/PlanosTratamentoPage.jsx
//
// Plano de tratamento é sobre clínica (o que tratar, em que ordem) — diferente
// do orçamento, que é sobre dinheiro. O paciente decide item a item (aceito
// ou recusado, com motivo obrigatório na recusa); só os itens aceitos viram
// orçamento de verdade, reaproveitando budgetsService (convertAcceptedItemsToBudget).

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const STATUS_LABELS = {
  rascunho: 'Rascunho', apresentado: 'Apresentado', aprovado: 'Aprovado',
  parcialmente_aprovado: 'Parcialmente aprovado', recusado: 'Recusado',
  cancelado: 'Cancelado', concluido: 'Concluído',
};
const STATUS_TRANSITIONS = ['apresentado', 'aprovado', 'parcialmente_aprovado', 'recusado', 'cancelado', 'concluido'];
const PRIORITY_LABELS = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

function statusBadgeClass(status) {
  if (['aprovado', 'concluido'].includes(status)) return 'badge badge-success';
  if (['recusado', 'cancelado'].includes(status)) return 'badge badge-alert';
  if (status === 'parcialmente_aprovado') return 'badge badge-warn';
  return 'badge badge-neutral';
}

function decisionBadgeClass(decision) {
  if (decision === 'aceito') return 'badge badge-success';
  if (decision === 'recusado') return 'badge badge-alert';
  return 'badge badge-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

function emptyItem() {
  return { procedureId: '', toothOrRegion: '', phase: '1', priority: 'media', labRequired: false, chargedValue: '' };
}

export function PlanosTratamentoPage() {
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [patient, setPatient] = useState(null);

  const [procedures, setProcedures] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [units, setUnits] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [professionalId, setProfessionalId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [decisionItemId, setDecisionItemId] = useState(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [actionError, setActionError] = useState(null);

  const [newStatus, setNewStatus] = useState('');

  useEffect(() => {
    api.get('/procedures').then(setProcedures).catch(() => {});
    api.get('/professionals').then(setProfessionals).catch(() => {});
    api.get('/units').then(setUnits).catch(() => {});
  }, []);

  useEffect(() => {
    if (!patientQuery || patient) { setPatientResults([]); return; }
    const handle = setTimeout(async () => {
      try { setPatientResults(await api.get(`/patients?q=${encodeURIComponent(patientQuery)}`)); }
      catch { setPatientResults([]); }
    }, 250);
    return () => clearTimeout(handle);
  }, [patientQuery, patient]);

  async function loadPlans(patientId) {
    setLoading(true);
    setPageError(null);
    try {
      setPlans(await api.get(`/treatment-plans/patients/${patientId}`));
      setSelectedPlan(null);
    } catch {
      setPageError('Não foi possível carregar os planos de tratamento deste paciente.');
    } finally {
      setLoading(false);
    }
  }

  function pickPatient(p) {
    setPatient(p);
    setPatientQuery(p.full_name);
    setPatientResults([]);
    setShowForm(false);
    loadPlans(p.id);
  }

  function clearPatient() {
    setPatient(null);
    setPatientQuery('');
    setPlans([]);
    setSelectedPlan(null);
  }

  async function openPlan(planId) {
    setActionError(null);
    try {
      setSelectedPlan(await api.get(`/treatment-plans/${planId}`));
    } catch {
      setActionError('Não foi possível abrir este plano.');
    }
  }

  function updateItem(index, patch) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function addItem() { setItems((prev) => [...prev, emptyItem()]); }
  function removeItem(index) { setItems((prev) => prev.filter((_, i) => i !== index)); }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    if (!professionalId) { setFormError('Selecione o profissional responsável.'); return; }
    const validItems = items.filter((it) => it.procedureId && it.chargedValue);
    if (validItems.length === 0) { setFormError('Adicione ao menos um item com procedimento e valor.'); return; }

    setSubmitting(true);
    try {
      await api.post('/treatment-plans', {
        patientId: patient.id,
        professionalId,
        notes: notes.trim() || null,
        items: validItems.map((it) => ({
          procedureId: it.procedureId,
          toothOrRegion: it.toothOrRegion.trim() || null,
          phase: Number(it.phase) || 1,
          priority: it.priority,
          labRequired: it.labRequired,
          chargedValue: Number(it.chargedValue),
        })),
      });
      setShowForm(false);
      setProfessionalId('');
      setNotes('');
      setItems([emptyItem()]);
      loadPlans(patient.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar o plano.');
    } finally {
      setSubmitting(false);
    }
  }

  function startDecision(item) {
    setDecisionItemId(item.id);
    setDecisionReason('');
    setActionError(null);
  }

  async function handleDecision(item, decision) {
    setActionError(null);
    if (decision === 'recusado' && !decisionReason.trim()) { setActionError('Motivo da recusa é obrigatório.'); return; }
    try {
      await api.post(`/treatment-plans/items/${item.id}/decision`, { decision, reason: decisionReason.trim() || undefined });
      setDecisionItemId(null);
      openPlan(selectedPlan.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível registrar a decisão.');
    }
  }

  async function handleStatusChange() {
    setActionError(null);
    if (!newStatus) return;
    try {
      await api.post(`/treatment-plans/${selectedPlan.id}/status`, { status: newStatus });
      setNewStatus('');
      openPlan(selectedPlan.id);
      loadPlans(patient.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mudar o status.');
    }
  }

  async function handleConvert() {
    setActionError(null);
    if (units.length === 0) { setActionError('Nenhuma unidade cadastrada nesta clínica ainda.'); return; }
    try {
      const budget = await api.post(`/treatment-plans/${selectedPlan.id}/convert-to-budget`, { unitId: units[0].id });
      setActionError(null);
      alert(`Orçamento gerado com sucesso — total ${formatCurrency(budget.total_amount)}. Veja em Orçamentos.`);
      openPlan(selectedPlan.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível converter em orçamento.');
    }
  }

  const acceptedCount = selectedPlan ? selectedPlan.items.filter((i) => i.patient_decision === 'aceito').length : 0;

  return (
    <div>
      <h1>Planos de Tratamento</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
        Sequência e prioridade clínica — o paciente decide item a item. Só os itens aceitos viram orçamento.
      </p>

      <div className="card" style={{ marginBottom: 20, position: 'relative' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="patientQuery">Paciente</label>
          {patient ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge badge-neutral">{patient.full_name}</span>
              <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }} onClick={clearPatient}>
                Trocar
              </button>
            </div>
          ) : (
            <input id="patientQuery" placeholder="Digite o nome do paciente…" value={patientQuery}
              onChange={(e) => setPatientQuery(e.target.value)} autoComplete="off" />
          )}
          {patientResults.length > 0 && (
            <div className="card" style={{ position: 'absolute', top: '100%', left: 20, right: 20, zIndex: 5, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
              {patientResults.map((p) => (
                <div key={p.id} onClick={() => pickPatient(p)} onMouseDown={(e) => e.preventDefault()}
                  style={{ padding: '8px 10px', cursor: 'pointer', borderRadius: 6 }}>
                  {p.full_name} {p.cpf && <span className="mono" style={{ color: 'var(--muted)' }}>· {p.cpf}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!patient ? (
        <div className="empty-state"><h2>Busque um paciente para ver os planos de tratamento</h2></div>
      ) : pageError ? (
        <div className="error-banner">{pageError}</div>
      ) : loading ? (
        <p style={{ color: 'var(--muted)' }}>Carregando…</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Planos</h3>
              <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => setShowForm(!showForm)}>Novo plano</button>
            </div>

            {showForm && (
              <form onSubmit={handleCreate} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                {formError && <div className="error-banner">{formError}</div>}
                <div className="card-grid" style={{ marginBottom: 10 }}>
                  <div className="field"><label>Profissional</label>
                    <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                      <option value="">Selecione…</option>
                      {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select></div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}><label>Observações</label>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>

                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Itens do plano</div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.7fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Procedimento</label>
                      <select value={item.procedureId} onChange={(e) => updateItem(i, { procedureId: e.target.value })}>
                        <option value="">Selecione…</option>
                        {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Dente/região</label>
                      <input value={item.toothOrRegion} onChange={(e) => updateItem(i, { toothOrRegion: e.target.value })} />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Fase</label>
                      <input type="number" min="1" value={item.phase} onChange={(e) => updateItem(i, { phase: e.target.value })} />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Prioridade</label>
                      <select value={item.priority} onChange={(e) => updateItem(i, { priority: e.target.value })}>
                        <option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option>
                      </select>
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Valor</label>
                      <input type="number" min="0" step="0.01" value={item.chargedValue} onChange={(e) => updateItem(i, { chargedValue: e.target.value })} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}>
                      <input type="checkbox" checked={item.labRequired} onChange={(e) => updateItem(i, { labRequired: e.target.checked })} /> Lab
                    </label>
                    <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 8px' }}
                      onClick={() => removeItem(i)} disabled={items.length === 1}>×</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={addItem}>+ item</button>
                  <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Salvando…' : 'Criar plano'}</button>
                </div>
              </form>
            )}

            {plans.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>Nenhum plano de tratamento ainda.</p>
            ) : (
              <table>
                <thead><tr><th>Profissional</th><th>Status</th><th>Itens</th><th>Criado em</th><th></th></tr></thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td>{p.professional_name}</td>
                      <td><span className={statusBadgeClass(p.status)}>{STATUS_LABELS[p.status] || p.status}</span></td>
                      <td className="mono">{p.notes || '—'}</td>
                      <td className="mono">{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }} onClick={() => openPlan(p.id)}>
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selectedPlan && (
            <div className="card">
              {actionError && <div className="error-banner">{actionError}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3 style={{ margin: 0 }}>Plano — {STATUS_LABELS[selectedPlan.status] || selectedPlan.status}</h3>
                {!['cancelado', 'concluido'].includes(selectedPlan.status) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                      <option value="">Mudar status…</option>
                      {STATUS_TRANSITIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={handleStatusChange} disabled={!newStatus}>
                      Aplicar
                    </button>
                  </div>
                )}
              </div>

              <table style={{ marginBottom: 14 }}>
                <thead><tr><th>Procedimento</th><th>Dente/região</th><th>Fase</th><th>Prioridade</th><th>Valor</th><th>Decisão</th><th>Ações</th></tr></thead>
                <tbody>
                  {selectedPlan.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.procedure_name}{item.lab_required && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>lab</span>}</td>
                      <td className="mono">{item.tooth_or_region || '—'}</td>
                      <td className="mono">{item.phase}</td>
                      <td>{PRIORITY_LABELS[item.priority] || item.priority}</td>
                      <td className="mono">{formatCurrency(item.charged_value)}</td>
                      <td>
                        <span className={decisionBadgeClass(item.patient_decision)}>{item.patient_decision}</span>
                        {item.patient_decision === 'recusado' && item.decision_reason && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{item.decision_reason}</div>
                        )}
                      </td>
                      <td>
                        {item.patient_decision === 'pendente' && decisionItemId !== item.id && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleDecision(item, 'aceito')}>Aceitar</button>
                            <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 8px', fontSize: 12 }} onClick={() => startDecision(item)}>Recusar</button>
                          </div>
                        )}
                        {decisionItemId === item.id && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input placeholder="Motivo da recusa" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} style={{ width: 150 }} />
                            <button className="btn" style={{ background: 'transparent', border: '1px solid var(--alert)', color: 'var(--alert)', padding: '4px 8px', fontSize: 12 }} onClick={() => handleDecision(item, 'recusado')}>OK</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button className="btn btn-primary" onClick={handleConvert} disabled={acceptedCount === 0}>
                Converter itens aceitos em orçamento ({acceptedCount})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
