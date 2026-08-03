// src/pages/ComprasPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const STATUS_LABELS = { solicitado: 'Solicitado', aprovado: 'Aprovado', pedido: 'Pedido', recebido: 'Recebido' };

function statusBadgeClass(status) {
  if (status === 'recebido') return 'badge badge-success';
  if (status === 'aprovado' || status === 'pedido') return 'badge badge-warn';
  return 'badge badge-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

function emptyItem() { return { itemId: '', quantity: '1', unitCost: '' }; }
const emptyForm = { supplierId: '', newSupplierName: '' };

export function ComprasPage() {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState([emptyItem()]);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [receivingId, setReceivingId] = useState(null);
  const [dueDate, setDueDate] = useState('');
  const [receiveError, setReceiveError] = useState(null);

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [orderRows, supplierRows, itemRows] = await Promise.all([
        api.get('/purchasing/orders'),
        api.get('/suppliers'),
        api.get('/inventory/items'),
      ]);
      setOrders(orderRows);
      setSuppliers(supplierRows);
      setInventoryItems(itemRows);
    } catch {
      setPageError('Não foi possível carregar as compras agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function updateItem(index, field, value) {
    setItems((list) => list.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  }
  function addItemRow() { setItems((list) => [...list, emptyItem()]); }
  function removeItemRow(index) { setItems((list) => list.filter((_, i) => i !== index)); }

  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0), 0);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    if (!form.supplierId && !form.newSupplierName.trim()) { setFormError('Escolha um fornecedor ou digite o nome de um novo.'); return; }
    const validItems = items.filter((it) => it.itemId && Number(it.quantity) > 0 && it.unitCost !== '');
    if (validItems.length === 0) { setFormError('Adicione ao menos um item com quantidade e custo.'); return; }

    setSubmitting(true);
    try {
      let supplierId = form.supplierId;
      if (!supplierId) {
        const created = await api.post('/suppliers', { legalName: form.newSupplierName.trim() });
        supplierId = created.id;
        setSuppliers((list) => [...list, created].sort((a, b) => a.legal_name.localeCompare(b.legal_name)));
      }
      await api.post('/purchasing/orders', {
        supplierId,
        items: validItems.map((it) => ({ itemId: it.itemId, quantity: Number(it.quantity), unitCost: Number(it.unitCost) })),
      });
      setForm(emptyForm);
      setItems([emptyItem()]);
      setShowForm(false);
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar o pedido.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(order) {
    setActionError(null);
    try {
      await api.post(`/purchasing/orders/${order.id}/approve`);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível aprovar o pedido.');
    }
  }

  function startReceiving(order) {
    setReceivingId(order.id);
    setDueDate('');
    setReceiveError(null);
  }

  async function handleReceive(order) {
    setReceiveError(null);
    if (!dueDate) { setReceiveError('Informe a data de vencimento da conta a pagar.'); return; }
    try {
      await api.post(`/purchasing/orders/${order.id}/receive`, { dueDate });
      setReceivingId(null);
      loadAll();
    } catch (err) {
      setReceiveError(err instanceof ApiError ? err.message : 'Não foi possível registrar o recebimento.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>Compras</h1>
          <p style={{ color: 'var(--muted)' }}>Receber um pedido dá entrada no estoque e gera a conta a pagar automaticamente.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)} disabled={inventoryItems.length === 0}>
          {showForm ? 'Cancelar' : '+ Novo pedido'}
        </button>
      </div>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}
      {!loading && inventoryItems.length === 0 && (
        <div className="error-banner">Cadastre ao menos um item no Estoque antes de criar um pedido de compra.</div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Novo pedido de compra</h3>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Fornecedor</label>
              {!form.supplierId && (
                <input placeholder="Nome de um novo fornecedor…" value={form.newSupplierName}
                  onChange={(e) => setForm((f) => ({ ...f, newSupplierName: e.target.value }))} style={{ marginBottom: 6 }} />
              )}
              <select value={form.supplierId} onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value, newSupplierName: '' }))}>
                <option value="">{form.newSupplierName ? '— ou escolha existente —' : 'Selecione um fornecedor…'}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
              </select>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginTop: 12 }}>Itens do pedido</label>
            {items.map((item, index) => (
              <div key={index} className="card-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', marginBottom: 8, marginTop: 6, alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <select value={item.itemId} onChange={(e) => updateItem(index, 'itemId', e.target.value)}>
                    <option value="">Selecione um item do estoque…</option>
                    {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}><input type="number" min="1" placeholder="Qtd." value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} /></div>
                <div className="field" style={{ marginBottom: 0 }}><input type="number" min="0" step="0.01" placeholder="Custo unit." value={item.unitCost} onChange={(e) => updateItem(index, 'unitCost', e.target.value)} /></div>
                <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)' }} onClick={() => removeItemRow(index)} disabled={items.length === 1}>Remover</button>
              </div>
            ))}
            <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', marginBottom: 14 }} onClick={addItemRow}>+ Adicionar item</button>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--border)', marginBottom: 14 }}>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(total)}</div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Salvando…' : 'Salvar pedido'}</button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : orders.length === 0 ? (
          <div className="empty-state"><h2>Nenhum pedido de compra</h2></div>
        ) : (
          <table>
            <thead><tr><th>Fornecedor</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.supplier_name}</td>
                  <td className="mono">{formatCurrency(o.total_amount)}</td>
                  <td><span className={statusBadgeClass(o.status)}>{STATUS_LABELS[o.status] || o.status}</span></td>
                  <td>
                    {o.status === 'solicitado' && <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleApprove(o)}>Aprovar</button>}
                    {o.status === 'aprovado' && receivingId !== o.id && (
                      <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startReceiving(o)}>Receber</button>
                    )}
                    {receivingId === o.id && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title="Vencimento da conta a pagar" />
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleReceive(o)}>OK</button>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setReceivingId(null)}>X</button>
                        {receiveError && <div className="error-banner" style={{ margin: 0 }}>{receiveError}</div>}
                      </div>
                    )}
                    {o.status === 'recebido' && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>—</span>}
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
