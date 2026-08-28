// src/pages/LaboratoriosPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const STATUS_LABELS = {
  solicitacao_criada: 'Solicitação criada',
  moldagem_pendente: 'Moldagem pendente',
  enviado: 'Enviado',
  em_producao: 'Em produção',
  prova_agendada: 'Prova agendada',
  ajuste_solicitado: 'Ajuste solicitado',
  reenviado: 'Reenviado',
  recebido: 'Recebido',
  instalado: 'Instalado',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);
const TERMINAL_STATUSES = ['finalizado', 'cancelado'];

function statusBadgeClass(status) {
  if (status === 'finalizado' || status === 'instalado') return 'badge badge-success';
  if (status === 'cancelado') return 'badge badge-alert';
  if (['ajuste_solicitado'].includes(status)) return 'badge badge-warn';
  return 'badge badge-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}
function formatDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
}
function isOverdue(order) {
  if (!order.expected_delivery_date) return false;
  if (['recebido', 'instalado', 'finalizado', 'cancelado'].includes(order.status)) return false;
  return new Date(order.expected_delivery_date) < new Date(new Date().toDateString());
}

const emptyForm = {
  patientQuery: '', patientId: null, patientName: '', professionalId: '',
  supplierId: '', newSupplierName: '', workType: '', toothOrRegion: '', color: '', material: '',
  cost: '', expectedDeliveryDate: '', notes: '',
};

export function LaboratoriosPage() {
  const [orders, setOrders] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [patientResults, setPatientResults] = useState([]);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [finalizingId, setFinalizingId] = useState(null);
  const [finalizeDueDate, setFinalizeDueDate] = useState('');
  const [finalizeError, setFinalizeError] = useState(null);

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [orderRows, overdueRows, profs, supps] = await Promise.all([
        api.get('/lab-orders'),
        api.get('/lab-orders/overdue'),
        api.get('/professionals'),
        api.get('/suppliers'),
      ]);
      setOrders(orderRows);
      setOverdue(overdueRows);
      setProfessionals(profs);
      setSuppliers(supps);
    } catch {
      setPageError('Não foi possível carregar os laboratórios agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!form.patientQuery || form.patientId) { setPatientResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        setPatientResults(await api.get(`/patients?q=${encodeURIComponent(form.patientQuery)}`));
      } catch {
        setPatientResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [form.patientQuery, form.patientId]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.patientId) { setFormError('Selecione um paciente cadastrado.'); return; }
    if (!form.professionalId) { setFormError('Selecione o profissional responsável.'); return; }
    if (!form.supplierId && !form.newSupplierName.trim()) { setFormError('Escolha um laboratório ou digite o nome de um novo.'); return; }
    if (!form.workType.trim()) { setFormError('Tipo de trabalho é obrigatório.'); return; }

    setSubmitting(true);
    try {
      let supplierId = form.supplierId;
      if (!supplierId) {
        const created = await api.post('/suppliers', { legalName: form.newSupplierName.trim() });
        supplierId = created.id;
        setSuppliers((list) => [...list, created].sort((a, b) => a.legal_name.localeCompare(b.legal_name)));
      }
      await api.post('/lab-orders', {
        patientId: form.patientId, professionalId: form.professionalId, supplierId,
        workType: form.workType.trim(), toothOrRegion: form.toothOrRegion || null,
        color: form.color || null, material: form.material || null,
        cost: form.cost ? Number(form.cost) : null, expectedDeliveryDate: form.expectedDeliveryDate || null,
        notes: form.notes || null,
      });
      setForm(emptyForm);
      setShowForm(false);
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar o trabalho.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangeStatus(order, newStatus) {
    setActionError(null);
    try {
      await api.post(`/lab-orders/${order.id}/status`, { status: newStatus });
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mudar o status.');
    }
  }

  function startFinalizing(order) {
    setFinalizingId(order.id);
    setFinalizeDueDate('');
    setFinalizeError(null);
  }

  async function handleFinalize(order) {
    setFinalizeError(null);
    if (!finalizeDueDate) { setFinalizeError('Informe a data de vencimento da conta a pagar.'); return; }
    try {
      await api.post(`/lab-orders/${order.id}/finalize`, { dueDate: finalizeDueDate });
      setFinalizingId(null);
      loadAll();
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : 'Não foi possível finalizar o trabalho.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>Laboratórios e Próteses</h1>
          <p style={{ color: 'var(--muted)' }}>Controle de trabalhos protéticos enviados a laboratório — do pedido à instalação. Finalizar um trabalho gera a conta a pagar automaticamente.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : '+ Novo trabalho'}</button>
      </div>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      {overdue.length > 0 && (
        <div className="chart-tab-block warn" style={{ marginBottom: 20 }}>
          <h2>Próteses atrasadas ({overdue.length})</h2>
          {overdue.slice(0, 5).map((item) => (
            <div className="alert-row" key={item.id}>
              <span>{item.patient_name} · {item.work_type} — {item.supplier_name}</span>
              <span className="mono">previsto {formatDate(item.expected_delivery_date)}</span>
            </div>
          ))}
          {overdue.length > 5 && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--muted)' }}>
              + {overdue.length - 5} outros trabalhos atrasados.
            </p>
          )}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="field" style={{ position: 'relative' }}>
              <label>Paciente</label>
              {form.patientId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge badge-neutral">{form.patientName}</span>
                  <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }}
                    onClick={() => setForm((f) => ({ ...f, patientId: null, patientName: '', patientQuery: '' }))}>Trocar</button>
                </div>
              ) : (
                <input placeholder="Digite o nome do paciente…" value={form.patientQuery}
                  onChange={(e) => setForm((f) => ({ ...f, patientQuery: e.target.value }))} autoComplete="off" />
              )}
              {patientResults.length > 0 && (
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {patientResults.map((p) => (
                    <div key={p.id} onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setForm((f) => ({ ...f, patientId: p.id, patientName: p.full_name, patientQuery: p.full_name }))}
                      style={{ padding: '8px 10px', cursor: 'pointer' }}>{p.full_name}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-grid" style={{ marginTop: 4, marginBottom: 8 }}>
              <div className="field">
                <label>Profissional</label>
                <select value={form.professionalId} onChange={(e) => setForm((f) => ({ ...f, professionalId: e.target.value }))}>
                  <option value="">Selecione…</option>
                  {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Laboratório</label>
                {!form.supplierId && (
                  <input placeholder="Nome de um novo laboratório…" value={form.newSupplierName}
                    onChange={(e) => setForm((f) => ({ ...f, newSupplierName: e.target.value }))} style={{ marginBottom: 6 }} />
                )}
                <select value={form.supplierId} onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value, newSupplierName: '' }))}>
                  <option value="">{form.newSupplierName ? '— ou escolha existente —' : 'Selecione um laboratório…'}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
                </select>
              </div>
              <div className="field"><label>Tipo de trabalho</label><input value={form.workType} onChange={(e) => setForm((f) => ({ ...f, workType: e.target.value }))} placeholder="Coroa em zircônia, prótese total…" /></div>
              <div className="field"><label>Dente/região (opcional)</label><input value={form.toothOrRegion} onChange={(e) => setForm((f) => ({ ...f, toothOrRegion: e.target.value }))} /></div>
              <div className="field"><label>Cor (opcional)</label><input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} /></div>
              <div className="field"><label>Material (opcional)</label><input value={form.material} onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} /></div>
              <div className="field"><label>Custo (opcional)</label><input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} /></div>
              <div className="field"><label>Previsão de entrega (opcional)</label><input type="date" value={form.expectedDeliveryDate} onChange={(e) => setForm((f) => ({ ...f, expectedDeliveryDate: e.target.value }))} /></div>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Observações (opcional)</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Instruções específicas para o laboratório…" />
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Salvando…' : 'Salvar trabalho'}</button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : orders.length === 0 ? (
          <div className="empty-state"><h2>Nenhum trabalho de laboratório</h2></div>
        ) : (
          <table>
            <thead><tr><th>Paciente</th><th>Laboratório</th><th>Trabalho</th><th>Previsão</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.patient_name}</td>
                  <td>{o.supplier_name}</td>
                  <td>{o.work_type}{o.cost ? ` · ${formatCurrency(o.cost)}` : ''}</td>
                  <td className="mono" style={isOverdue(o) ? { color: 'var(--alert)' } : undefined}>
                    {formatDate(o.expected_delivery_date)}{isOverdue(o) ? ' ⚠' : ''}
                  </td>
                  <td><span className={statusBadgeClass(o.status)}>{STATUS_LABELS[o.status] || o.status}</span></td>
                  <td>
                    {TERMINAL_STATUSES.includes(o.status) ? (
                      <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>—</span>
                    ) : finalizingId === o.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="date" value={finalizeDueDate} onChange={(e) => setFinalizeDueDate(e.target.value)} title="Vencimento da conta a pagar" />
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleFinalize(o)}>OK</button>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setFinalizingId(null)}>X</button>
                        {finalizeError && <div className="error-banner" style={{ margin: 0 }}>{finalizeError}</div>}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select value="" onChange={(e) => { if (e.target.value) handleChangeStatus(o, e.target.value); }}>
                          <option value="">Mudar status…</option>
                          {STATUS_ORDER.filter((s) => s !== o.status).map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startFinalizing(o)}>Finalizar</button>
                      </div>
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
