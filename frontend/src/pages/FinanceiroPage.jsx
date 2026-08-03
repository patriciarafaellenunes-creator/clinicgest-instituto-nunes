// src/pages/FinanceiroPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const PAYABLE_STATUS_LABELS = { pendente: 'Pendente', aprovado: 'Aprovado', pago: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado' };
const RECEIVABLE_STATUS_LABELS = { pendente: 'Pendente', parcialmente_pago: 'Parcialmente pago', pago: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado', estornado: 'Estornado' };
const RECEIVABLE_CLOSED = ['pago', 'cancelado', 'estornado'];

function statusBadgeClass(status) {
  if (status === 'pago') return 'badge badge-success';
  if (['vencido', 'cancelado', 'estornado'].includes(status)) return 'badge badge-alert';
  if (status === 'aprovado' || status === 'parcialmente_pago') return 'badge badge-warn';
  return 'badge badge-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}
function formatDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
}

const emptyPayableForm = { supplierId: '', newSupplierName: '', description: '', amount: '', dueDate: '', costNature: '' };
const emptyReceivableForm = { patientQuery: '', patientId: null, patientName: '', description: '', amount: '', dueDate: '' };
const emptyBankAccountForm = { name: '', bankName: '', initialBalance: '' };

export function FinanceiroPage() {
  const [payables, setPayables] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState(emptyBankAccountForm);
  const [bankSubmitting, setBankSubmitting] = useState(false);

  const [showPayableForm, setShowPayableForm] = useState(false);
  const [payableForm, setPayableForm] = useState(emptyPayableForm);
  const [payableError, setPayableError] = useState(null);
  const [payableSubmitting, setPayableSubmitting] = useState(false);

  const [showReceivableForm, setShowReceivableForm] = useState(false);
  const [receivableForm, setReceivableForm] = useState(emptyReceivableForm);
  const [patientResults, setPatientResults] = useState([]);
  const [receivableError, setReceivableError] = useState(null);
  const [receivableSubmitting, setReceivableSubmitting] = useState(false);

  const [payingId, setPayingId] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payBankAccountId, setPayBankAccountId] = useState('');

  const [receivingId, setReceivingId] = useState(null);
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveBankAccountId, setReceiveBankAccountId] = useState('');

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [payableRows, receivableRows, supplierRows, bankRows] = await Promise.all([
        api.get('/financial/accounts-payable'),
        api.get('/financial/accounts-receivable'),
        api.get('/suppliers'),
        api.get('/bank-accounts'),
      ]);
      setPayables(payableRows);
      setReceivables(receivableRows);
      setSuppliers(supplierRows);
      setBankAccounts(bankRows);
    } catch {
      setPageError('Não foi possível carregar o financeiro agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!receivableForm.patientQuery || receivableForm.patientId) { setPatientResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        setPatientResults(await api.get(`/patients?q=${encodeURIComponent(receivableForm.patientQuery)}`));
      } catch {
        setPatientResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [receivableForm.patientQuery, receivableForm.patientId]);

  async function handleCreateBankAccount(e) {
    e.preventDefault();
    setBankSubmitting(true);
    try {
      await api.post('/bank-accounts', {
        name: bankForm.name, bankName: bankForm.bankName || null,
        initialBalance: bankForm.initialBalance ? Number(bankForm.initialBalance) : 0,
      });
      setBankForm(emptyBankAccountForm);
      setShowBankForm(false);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta bancária.');
    } finally {
      setBankSubmitting(false);
    }
  }

  async function handleCreatePayable(e) {
    e.preventDefault();
    setPayableError(null);
    if (!payableForm.description.trim()) { setPayableError('Descrição é obrigatória.'); return; }
    if (!payableForm.supplierId && !payableForm.newSupplierName.trim()) { setPayableError('Escolha um fornecedor ou digite o nome de um novo.'); return; }
    if (!payableForm.amount || !payableForm.dueDate) { setPayableError('Valor e vencimento são obrigatórios.'); return; }

    setPayableSubmitting(true);
    try {
      let supplierId = payableForm.supplierId;
      if (!supplierId && payableForm.newSupplierName.trim()) {
        const created = await api.post('/suppliers', { legalName: payableForm.newSupplierName.trim() });
        supplierId = created.id;
        setSuppliers((list) => [...list, created].sort((a, b) => a.legal_name.localeCompare(b.legal_name)));
      }
      await api.post('/financial/accounts-payable', {
        supplierId, description: payableForm.description.trim(),
        competenceDate: payableForm.dueDate, dueDate: payableForm.dueDate,
        amount: Number(payableForm.amount), costNature: payableForm.costNature || null,
      });
      setPayableForm(emptyPayableForm);
      setShowPayableForm(false);
      loadAll();
    } catch (err) {
      setPayableError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta a pagar.');
    } finally {
      setPayableSubmitting(false);
    }
  }

  async function handleCreateReceivable(e) {
    e.preventDefault();
    setReceivableError(null);
    if (!receivableForm.patientId) { setReceivableError('Selecione um paciente cadastrado.'); return; }
    if (!receivableForm.amount || !receivableForm.dueDate) { setReceivableError('Valor e vencimento são obrigatórios.'); return; }

    setReceivableSubmitting(true);
    try {
      await api.post('/financial/accounts-receivable', {
        patientId: receivableForm.patientId, description: receivableForm.description.trim() || null,
        competenceDate: receivableForm.dueDate, dueDate: receivableForm.dueDate, amount: Number(receivableForm.amount),
      });
      setReceivableForm(emptyReceivableForm);
      setShowReceivableForm(false);
      loadAll();
    } catch (err) {
      setReceivableError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta a receber.');
    } finally {
      setReceivableSubmitting(false);
    }
  }

  async function handleApprovePayable(item) {
    setActionError(null);
    try {
      await api.post(`/financial/accounts-payable/${item.id}/approve`);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível aprovar.');
    }
  }

  function startPaying(item) {
    setPayingId(item.id);
    setPayAmount(String(Number(item.amount) - Number(item.paid_amount)));
    setPayBankAccountId(bankAccounts[0]?.id || '');
  }

  async function handlePay(item) {
    setActionError(null);
    if (!payBankAccountId) { setActionError('Cadastre uma conta bancária antes de registrar pagamentos.'); return; }
    try {
      await api.post(`/financial/accounts-payable/${item.id}/pay`, { paidAmount: Number(payAmount), bankAccountId: payBankAccountId });
      setPayingId(null);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível registrar o pagamento.');
    }
  }

  function startReceiving(item) {
    setReceivingId(item.id);
    setReceiveAmount(String(Number(item.amount) - Number(item.received_amount)));
    setReceiveBankAccountId(bankAccounts[0]?.id || '');
  }

  async function handleReceive(item) {
    setActionError(null);
    if (!receiveBankAccountId) { setActionError('Cadastre uma conta bancária antes de registrar recebimentos.'); return; }
    try {
      await api.post(`/financial/accounts-receivable/${item.id}/receive`, { receivedAmount: Number(receiveAmount), bankAccountId: receiveBankAccountId });
      setReceivingId(null);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível registrar o recebimento.');
    }
  }

  return (
    <div>
      <h1>Contas e Caixa</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Contas a pagar, a receber, e as contas bancárias da clínica.</p>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: bankAccounts.length ? 14 : 0 }}>
          <h3 style={{ margin: 0 }}>Contas bancárias</h3>
          <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)' }} onClick={() => setShowBankForm((v) => !v)}>
            {showBankForm ? 'Cancelar' : '+ Nova conta'}
          </button>
        </div>
        {bankAccounts.length === 0 && !showBankForm && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Nenhuma conta bancária cadastrada ainda — cadastre uma antes de registrar pagamentos ou recebimentos.
          </p>
        )}
        {bankAccounts.length > 0 && (
          <div className="card-grid" style={{ marginBottom: 0 }}>
            {bankAccounts.map((b) => (
              <div className="stat-card" key={b.id}>
                <div className="stat-label">{b.name}{b.bank_name ? ` · ${b.bank_name}` : ''}</div>
                <div className="stat-value mono">{formatCurrency(b.current_balance)}</div>
              </div>
            ))}
          </div>
        )}
        {showBankForm && (
          <form onSubmit={handleCreateBankAccount} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div className="card-grid" style={{ marginBottom: 0 }}>
              <div className="field"><label>Nome da conta</label><input required value={bankForm.name} onChange={(e) => setBankForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex.: Conta Principal, Caixa" /></div>
              <div className="field"><label>Banco (opcional)</label><input value={bankForm.bankName} onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
              <div className="field"><label>Saldo inicial</label><input type="number" step="0.01" value={bankForm.initialBalance} onChange={(e) => setBankForm((f) => ({ ...f, initialBalance: e.target.value }))} /></div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={bankSubmitting} style={{ marginTop: 10 }}>
              {bankSubmitting ? 'Salvando…' : 'Salvar conta'}
            </button>
          </form>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>A pagar</h2>
        <button className="btn btn-primary" onClick={() => setShowPayableForm((v) => !v)}>{showPayableForm ? 'Cancelar' : '+ Nova conta a pagar'}</button>
      </div>

      {showPayableForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          {payableError && <div className="error-banner">{payableError}</div>}
          <form onSubmit={handleCreatePayable}>
            <div className="card-grid" style={{ marginBottom: 8 }}>
              <div className="field">
                <label>Fornecedor</label>
                {!payableForm.supplierId && (
                  <input placeholder="Nome de um novo fornecedor…" value={payableForm.newSupplierName}
                    onChange={(e) => setPayableForm((f) => ({ ...f, newSupplierName: e.target.value }))} style={{ marginBottom: 6 }} />
                )}
                <select value={payableForm.supplierId} onChange={(e) => setPayableForm((f) => ({ ...f, supplierId: e.target.value, newSupplierName: '' }))}>
                  <option value="">{payableForm.newSupplierName ? '— ou escolha existente —' : 'Selecione um fornecedor…'}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
                </select>
              </div>
              <div className="field"><label>Descrição</label><input value={payableForm.description} onChange={(e) => setPayableForm((f) => ({ ...f, description: e.target.value }))} /></div>
              <div className="field"><label>Valor</label><input type="number" min="0" step="0.01" value={payableForm.amount} onChange={(e) => setPayableForm((f) => ({ ...f, amount: e.target.value }))} /></div>
              <div className="field"><label>Vencimento</label><input type="date" value={payableForm.dueDate} onChange={(e) => setPayableForm((f) => ({ ...f, dueDate: e.target.value }))} /></div>
              <div className="field">
                <label>Natureza (opcional)</label>
                <select value={payableForm.costNature} onChange={(e) => setPayableForm((f) => ({ ...f, costNature: e.target.value }))}>
                  <option value="">Não informado</option>
                  <option value="fixo">Fixo</option>
                  <option value="variavel">Variável</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={payableSubmitting}>{payableSubmitting ? 'Salvando…' : 'Salvar conta a pagar'}</button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0, marginBottom: 28 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : payables.length === 0 ? (
          <div className="empty-state"><h2>Nenhuma conta a pagar</h2></div>
        ) : (
          <table>
            <thead><tr><th>Fornecedor</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {payables.map((p) => (
                <tr key={p.id}>
                  <td>{p.supplier_name || '—'}</td>
                  <td>{p.description}</td>
                  <td className="mono">{formatCurrency(p.amount)}</td>
                  <td className="mono">{formatDate(p.due_date)}</td>
                  <td><span className={statusBadgeClass(p.status)}>{PAYABLE_STATUS_LABELS[p.status] || p.status}</span></td>
                  <td>
                    {p.status === 'pendente' && <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleApprovePayable(p)}>Aprovar</button>}
                    {p.status === 'aprovado' && payingId !== p.id && (
                      <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startPaying(p)}>Pagar</button>
                    )}
                    {payingId === p.id && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select value={payBankAccountId} onChange={(e) => setPayBankAccountId(e.target.value)}>
                          {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        <input type="number" style={{ width: 90 }} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handlePay(p)}>OK</button>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setPayingId(null)}>X</button>
                      </div>
                    )}
                    {['pago', 'cancelado'].includes(p.status) && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>A receber</h2>
        <button className="btn btn-primary" onClick={() => setShowReceivableForm((v) => !v)}>{showReceivableForm ? 'Cancelar' : '+ Nova conta a receber'}</button>
      </div>

      {showReceivableForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          {receivableError && <div className="error-banner">{receivableError}</div>}
          <form onSubmit={handleCreateReceivable}>
            <div className="field" style={{ position: 'relative' }}>
              <label>Paciente</label>
              {receivableForm.patientId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge badge-neutral">{receivableForm.patientName}</span>
                  <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }}
                    onClick={() => setReceivableForm((f) => ({ ...f, patientId: null, patientName: '', patientQuery: '' }))}>Trocar</button>
                </div>
              ) : (
                <input placeholder="Digite o nome do paciente…" value={receivableForm.patientQuery}
                  onChange={(e) => setReceivableForm((f) => ({ ...f, patientQuery: e.target.value }))} autoComplete="off" />
              )}
              {patientResults.length > 0 && (
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {patientResults.map((p) => (
                    <div key={p.id} onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setReceivableForm((f) => ({ ...f, patientId: p.id, patientName: p.full_name, patientQuery: p.full_name }))}
                      style={{ padding: '8px 10px', cursor: 'pointer' }}>{p.full_name}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="card-grid" style={{ marginTop: 4, marginBottom: 8 }}>
              <div className="field"><label>Descrição (opcional)</label><input value={receivableForm.description} onChange={(e) => setReceivableForm((f) => ({ ...f, description: e.target.value }))} /></div>
              <div className="field"><label>Valor</label><input type="number" min="0" step="0.01" value={receivableForm.amount} onChange={(e) => setReceivableForm((f) => ({ ...f, amount: e.target.value }))} /></div>
              <div className="field"><label>Vencimento</label><input type="date" value={receivableForm.dueDate} onChange={(e) => setReceivableForm((f) => ({ ...f, dueDate: e.target.value }))} /></div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={receivableSubmitting}>{receivableSubmitting ? 'Salvando…' : 'Salvar conta a receber'}</button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : receivables.length === 0 ? (
          <div className="empty-state"><h2>Nenhuma conta a receber</h2></div>
        ) : (
          <table>
            <thead><tr><th>Paciente</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.id}>
                  <td>{r.patient_name || '—'}</td>
                  <td>{r.description || '—'}</td>
                  <td className="mono">{formatCurrency(r.amount)}</td>
                  <td className="mono">{formatDate(r.due_date)}</td>
                  <td><span className={statusBadgeClass(r.status)}>{RECEIVABLE_STATUS_LABELS[r.status] || r.status}</span></td>
                  <td>
                    {!RECEIVABLE_CLOSED.includes(r.status) && receivingId !== r.id && (
                      <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startReceiving(r)}>Receber</button>
                    )}
                    {receivingId === r.id && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select value={receiveBankAccountId} onChange={(e) => setReceiveBankAccountId(e.target.value)}>
                          {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        <input type="number" style={{ width: 90 }} value={receiveAmount} onChange={(e) => setReceiveAmount(e.target.value)} />
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleReceive(r)}>OK</button>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setReceivingId(null)}>X</button>
                      </div>
                    )}
                    {RECEIVABLE_CLOSED.includes(r.status) && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>—</span>}
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
