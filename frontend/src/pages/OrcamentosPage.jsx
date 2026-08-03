// src/pages/OrcamentosPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

const STATUS_LABELS = {
  rascunho: 'Rascunho',
  apresentado: 'Apresentado',
  em_negociacao: 'Em negociação',
  aprovado: 'Aprovado',
  parcialmente_aprovado: 'Parcialmente aprovado',
  recusado: 'Recusado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};
const CHANGEABLE_STATUSES = ['apresentado', 'em_negociacao', 'recusado', 'expirado', 'cancelado'];
const APPROVABLE_FROM = ['apresentado', 'em_negociacao'];
const FINAL_STATUSES = ['aprovado', 'cancelado'];

function statusBadgeClass(status) {
  if (status === 'aprovado') return 'badge badge-success';
  if (['recusado', 'cancelado'].includes(status)) return 'badge badge-alert';
  if (['expirado'].includes(status)) return 'badge badge-warn';
  return 'badge badge-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

function emptyItem() {
  return { procedureId: '', newProcedureName: '', quantity: '1', unitPrice: '', discount: '0' };
}

const emptyForm = { patientQuery: '', patientId: null, patientName: '', professionalId: '', validUntil: '', authorizeDiscount: false };

export function OrcamentosPage() {
  const { user } = useAuth();
  const [budgets, setBudgets] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState([emptyItem()]);
  const [patientResults, setPatientResults] = useState([]);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [approvingId, setApprovingId] = useState(null);
  const [approveForm, setApproveForm] = useState({ installmentCount: '1', firstDueDate: '' });
  const [approveError, setApproveError] = useState(null);
  const [approving, setApproving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [budgetRows, procs, profs, unitList] = await Promise.all([
        api.get('/budgets'),
        api.get('/procedures'),
        api.get('/professionals'),
        api.get('/units'),
      ]);
      setBudgets(budgetRows);
      setProcedures(procs);
      setProfessionals(profs);
      setUnits(unitList);
    } catch {
      setPageError('Não foi possível carregar os orçamentos agora.');
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

  function updateField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function pickPatient(p) {
    setForm((f) => ({ ...f, patientId: p.id, patientName: p.full_name, patientQuery: p.full_name }));
    setPatientResults([]);
  }

  function updateItem(index, field, value) {
    setItems((list) => list.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  }

  function addItemRow() {
    setItems((list) => [...list, emptyItem()]);
  }

  function removeItemRow(index) {
    setItems((list) => list.filter((_, i) => i !== index));
  }

  const total = items.reduce((sum, it) => {
    const gross = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    return sum + Math.max(0, gross - (Number(it.discount) || 0));
  }, 0);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);

    if (!form.patientId) { setFormError('Selecione um paciente cadastrado.'); return; }
    if (units.length === 0) { setFormError('Nenhuma unidade cadastrada nesta clínica ainda.'); return; }
    const validItems = items.filter((it) => (it.procedureId || it.newProcedureName.trim()) && Number(it.quantity) > 0 && it.unitPrice !== '');
    if (validItems.length === 0) { setFormError('Adicione ao menos um item com procedimento, quantidade e valor.'); return; }

    setSubmitting(true);
    try {
      const resolvedItems = [];
      for (const it of validItems) {
        let procedureId = it.procedureId;
        if (!procedureId && it.newProcedureName.trim()) {
          const created = await api.post('/procedures', { name: it.newProcedureName.trim() });
          procedureId = created.id;
          setProcedures((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
        }
        resolvedItems.push({
          procedureId, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), discount: Number(it.discount) || 0,
        });
      }

      await api.post('/budgets', {
        unitId: units[0].id,
        patientId: form.patientId,
        professionalId: form.professionalId || null,
        items: resolvedItems,
        validUntil: form.validUntil || null,
        discountApprovedBy: form.authorizeDiscount ? user.id : undefined,
      });

      setForm(emptyForm);
      setItems([emptyItem()]);
      setShowForm(false);
      loadAll();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DISCOUNT_APPROVAL_REQUIRED') {
        setFormError(`${err.message} Marque "autorizar desconto" abaixo e envie de novo.`);
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar o orçamento.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangeStatus(budget, newStatus) {
    setActionError(null);
    try {
      await api.post(`/budgets/${budget.id}/status`, { status: newStatus });
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mudar o status.');
    }
  }

  function startApproving(budget) {
    setApprovingId(budget.id);
    setApproveError(null);
    setApproveForm({ installmentCount: '1', firstDueDate: '' });
  }

  async function handleApprove(budget) {
    setApproveError(null);
    if (!approveForm.firstDueDate) { setApproveError('Informe a data de vencimento da primeira parcela.'); return; }
    setApproving(true);
    try {
      await api.post(`/budgets/${budget.id}/approve`, {
        unitId: units[0]?.id,
        installmentCount: Number(approveForm.installmentCount) || 1,
        firstDueDate: approveForm.firstDueDate,
      });
      setApprovingId(null);
      loadAll();
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : 'Não foi possível aprovar o orçamento.');
    } finally {
      setApproving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>Orçamentos</h1>
          <p style={{ color: 'var(--muted)' }}>Aprovar gera contrato, parcelas e contas a receber automaticamente.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Novo orçamento'}
        </button>
      </div>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Novo orçamento</h3>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="field" style={{ position: 'relative' }}>
              <label htmlFor="patientQuery">Paciente</label>
              {form.patientId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge badge-neutral">{form.patientName}</span>
                  <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }} onClick={() => setForm((f) => ({ ...f, patientId: null, patientName: '', patientQuery: '' }))}>
                    Trocar
                  </button>
                </div>
              ) : (
                <input id="patientQuery" placeholder="Digite o nome do paciente…" value={form.patientQuery} onChange={updateField('patientQuery')} autoComplete="off" />
              )}
              {patientResults.length > 0 && (
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {patientResults.map((p) => (
                    <div key={p.id} onClick={() => pickPatient(p)} onMouseDown={(e) => e.preventDefault()} style={{ padding: '8px 10px', cursor: 'pointer' }}>
                      {p.full_name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 4, marginBottom: 4 }}>
              <div className="field">
                <label htmlFor="professionalId">Profissional (opcional)</label>
                <select id="professionalId" value={form.professionalId} onChange={updateField('professionalId')}>
                  <option value="">Não informado</option>
                  {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="validUntil">Válido até (opcional)</label>
                <input id="validUntil" type="date" value={form.validUntil} onChange={updateField('validUntil')} />
              </div>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Itens do orçamento</label>
            {items.map((item, index) => (
              <div key={index} className="card-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto', marginBottom: 8, marginTop: 6, alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  {!item.procedureId ? (
                    <input placeholder="Nome do procedimento…" value={item.newProcedureName} onChange={(e) => updateItem(index, 'newProcedureName', e.target.value)} />
                  ) : null}
                  <select
                    value={item.procedureId}
                    onChange={(e) => updateItem(index, 'procedureId', e.target.value)}
                    style={item.procedureId ? {} : { marginTop: 6 }}
                  >
                    <option value="">{item.newProcedureName ? '— ou escolha existente —' : 'Selecione um procedimento…'}</option>
                    {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <input type="number" min="1" placeholder="Qtd." value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <input type="number" min="0" step="0.01" placeholder="Valor unit." value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <input type="number" min="0" step="0.01" placeholder="Desconto" value={item.discount} onChange={(e) => updateItem(index, 'discount', e.target.value)} />
                </div>
                <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)' }} onClick={() => removeItemRow(index)} disabled={items.length === 1}>
                  Remover
                </button>
              </div>
            ))}
            <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', marginBottom: 14 }} onClick={addItemRow}>
              + Adicionar item
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={form.authorizeDiscount} onChange={(e) => setForm((f) => ({ ...f, authorizeDiscount: e.target.checked }))} />
                Autorizo desconto acima de 10% (fico responsável por essa autorização)
              </label>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(total)}</div>
            </div>

            <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginTop: 14 }}>
              {submitting ? 'Salvando…' : 'Salvar orçamento'}
            </button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state"><p>Carregando…</p></div>
        ) : budgets.length === 0 ? (
          <div className="empty-state">
            <h2>Nenhum orçamento cadastrado</h2>
            <p>Crie o primeiro orçamento para um paciente.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Total</th>
                <th>Desconto</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b.id}>
                  <td>{b.patient_name}</td>
                  <td className="mono">{formatCurrency(b.total_amount)}</td>
                  <td className="mono">{formatCurrency(b.discount_amount)}</td>
                  <td><span className={statusBadgeClass(b.status)}>{STATUS_LABELS[b.status] || b.status}</span></td>
                  <td>
                    {FINAL_STATUSES.includes(b.status) ? (
                      <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>—</span>
                    ) : approvingId === b.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="number" min="1" style={{ width: 60 }} value={approveForm.installmentCount}
                          onChange={(e) => setApproveForm((f) => ({ ...f, installmentCount: e.target.value }))} title="Número de parcelas" />
                        <input type="date" value={approveForm.firstDueDate}
                          onChange={(e) => setApproveForm((f) => ({ ...f, firstDueDate: e.target.value }))} title="Vencimento da 1ª parcela" />
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} disabled={approving} onClick={() => handleApprove(b)}>
                          {approving ? '...' : 'OK'}
                        </button>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setApprovingId(null)}>
                          X
                        </button>
                        {approveError && <div className="error-banner" style={{ margin: 0 }}>{approveError}</div>}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        {APPROVABLE_FROM.includes(b.status) && (
                          <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startApproving(b)}>Aprovar</button>
                        )}
                        <select value="" onChange={(e) => { if (e.target.value) handleChangeStatus(b, e.target.value); }}>
                          <option value="">Mudar status…</option>
                          {CHANGEABLE_STATUSES.filter((s) => s !== b.status).map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
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
