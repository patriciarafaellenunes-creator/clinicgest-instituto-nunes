// src/pages/EstoquePage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

const emptyForm = { name: '', category: '', unitOfMeasure: '', minQuantity: '0' };

export function EstoquePage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [activeItemId, setActiveItemId] = useState(null);
  const [activeMode, setActiveMode] = useState(null); // 'receive' | 'adjust'
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');

  async function loadItems() {
    setLoading(true);
    setPageError(null);
    try {
      setItems(await api.get('/inventory/items'));
    } catch {
      setPageError('Não foi possível carregar o estoque agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadItems(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError('Nome do item é obrigatório.'); return; }
    setSubmitting(true);
    try {
      await api.post('/inventory/items', { ...form, minQuantity: Number(form.minQuantity) || 0 });
      setForm(emptyForm);
      setShowForm(false);
      loadItems();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o item.');
    } finally {
      setSubmitting(false);
    }
  }

  function startReceiving(item) {
    setActiveItemId(item.id);
    setActiveMode('receive');
    setQuantity('');
    setUnitCost('');
  }

  function startAdjusting(item) {
    setActiveItemId(item.id);
    setActiveMode('adjust');
    setQuantity(String(item.current_quantity));
    setReason('');
  }

  function cancelAction() {
    setActiveItemId(null);
    setActiveMode(null);
  }

  async function handleReceive(item) {
    setActionError(null);
    try {
      await api.post(`/inventory/items/${item.id}/receive`, { quantity: Number(quantity), unitCost: unitCost ? Number(unitCost) : undefined });
      cancelAction();
      loadItems();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível registrar a entrada.');
    }
  }

  async function handleAdjust(item) {
    setActionError(null);
    try {
      await api.post(`/inventory/items/${item.id}/adjust`, { newQuantity: Number(quantity), reason: reason || null });
      cancelAction();
      loadItems();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível ajustar o estoque.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>Estoque</h1>
          <p style={{ color: 'var(--muted)' }}>Itens críticos ficam destacados quando a quantidade atual chega no mínimo.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : '+ Novo item'}</button>
      </div>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Cadastrar item</h3>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="card-grid" style={{ marginBottom: 0 }}>
              <div className="field"><label>Nome</label><input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="field"><label>Categoria</label><input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Medicamento, cirúrgico…" /></div>
              <div className="field"><label>Unidade de medida</label><input value={form.unitOfMeasure} onChange={(e) => setForm((f) => ({ ...f, unitOfMeasure: e.target.value }))} placeholder="cx, un, seringa…" /></div>
              <div className="field"><label>Estoque mínimo</label><input type="number" min="0" value={form.minQuantity} onChange={(e) => setForm((f) => ({ ...f, minQuantity: e.target.value }))} /></div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginTop: 6 }}>{submitting ? 'Salvando…' : 'Salvar item'}</button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : items.length === 0 ? (
          <div className="empty-state"><h2>Nenhum item cadastrado</h2><p>Cadastre o primeiro item do estoque.</p></div>
        ) : (
          <table>
            <thead><tr><th>Item</th><th>Categoria</th><th>Qtd. atual</th><th>Mínimo</th><th>Custo médio</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const critical = Number(item.current_quantity) <= Number(item.min_quantity);
                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.category || '—'}</td>
                    <td className="mono">{item.current_quantity} {item.unit_of_measure || ''}</td>
                    <td className="mono">{item.min_quantity}</td>
                    <td className="mono">{formatCurrency(item.avg_cost)}</td>
                    <td><span className={`badge ${critical ? 'badge-alert' : 'badge-success'}`}>{critical ? 'Crítico' : 'OK'}</span></td>
                    <td>
                      {activeItemId === item.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {activeMode === 'receive' ? (
                            <>
                              <input type="number" min="0" placeholder="Qtd." style={{ width: 70 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                              <input type="number" min="0" step="0.01" placeholder="Custo unit." style={{ width: 90 }} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                              <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleReceive(item)}>OK</button>
                            </>
                          ) : (
                            <>
                              <input type="number" min="0" placeholder="Nova qtd." style={{ width: 80 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                              <input placeholder="Motivo" style={{ width: 120 }} value={reason} onChange={(e) => setReason(e.target.value)} />
                              <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleAdjust(item)}>OK</button>
                            </>
                          )}
                          <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={cancelAction}>X</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startReceiving(item)}>Entrada</button>
                          <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => startAdjusting(item)}>Ajustar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
