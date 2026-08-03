// src/pages/ComissoesPage.jsx
//
// Comissão só pode ser calculada para um profissional com contrato ASSINADO
// definindo o percentual (módulo de Contratos de Profissionais, que ainda
// não tinha nenhuma tela). Por isso esta página cobre as duas pontas: criar
// e assinar o contrato de comissão, e depois calcular/aprovar/pagar.

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const LEGAL_DISCLAIMER = 'Este documento é gerado automaticamente pelo sistema e não tem validade jurídica por si só — revisão por advogado é necessária antes do uso definitivo.';

const PAYOUT_STATUS_LABELS = { calculado: 'Calculado', aprovado: 'Aprovado', pago: 'Pago', cancelado: 'Cancelado' };

function statusBadgeClass(status) {
  if (status === 'pago') return 'badge badge-success';
  if (status === 'cancelado') return 'badge badge-alert';
  if (status === 'aprovado') return 'badge badge-warn';
  return 'badge badge-neutral';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

export function ComissoesPage() {
  const [professionals, setProfessionals] = useState([]);
  const [contractInfo, setContractInfo] = useState({});
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [creatingContractFor, setCreatingContractFor] = useState(null);
  const [commissionPercentage, setCommissionPercentage] = useState('');
  const [contractError, setContractError] = useState(null);
  const [pendingContract, setPendingContract] = useState(null); // { documentId, signatures }

  const [calcProfessionalId, setCalcProfessionalId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [calcError, setCalcError] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const [payingId, setPayingId] = useState(null);
  const [payDueDate, setPayDueDate] = useState('');

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [profs, payoutRows] = await Promise.all([
        api.get('/professionals'),
        api.get('/commissions'),
      ]);
      setProfessionals(profs);
      setPayouts(payoutRows);

      const infoEntries = await Promise.all(
        profs.map(async (p) => {
          try {
            const info = await api.get(`/professional-contracts/professionals/${p.id}/authorization`);
            return [p.id, info];
          } catch {
            return [p.id, { hasContract: false }];
          }
        })
      );
      setContractInfo(Object.fromEntries(infoEntries));
    } catch {
      setPageError('Não foi possível carregar as comissões agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function startCreatingContract(professional) {
    setCreatingContractFor(professional.id);
    setCommissionPercentage('');
    setContractError(null);
    setPendingContract(null);
  }

  async function handleCreateContract(professional) {
    setContractError(null);
    const pct = Number(commissionPercentage);
    if (!pct || pct <= 0 || pct > 100) { setContractError('Informe um percentual válido (entre 0 e 100).'); return; }

    try {
      const content = `Contrato de comissão — ${professional.full_name}. Comissão de ${pct}% sobre o valor efetivamente recebido de pacientes atendidos por este profissional. ${LEGAL_DISCLAIMER}`;
      const { document } = await api.post('/professional-contracts', {
        professionalId: professional.id,
        content,
        remunerationType: 'comissao_recebimento',
        commissionPercentage: pct,
        validFrom: new Date().toISOString().slice(0, 10),
        signers: [
          { signerName: professional.full_name, signerRole: 'profissional' },
          { signerName: 'Responsável pela clínica', signerRole: 'gestor' },
        ],
      });
      const full = await api.get(`/professional-contracts/${document.id}`);
      setPendingContract({ documentId: document.id, signatures: full.signatures });
    } catch (err) {
      setContractError(err instanceof ApiError ? err.message : 'Não foi possível criar o contrato.');
    }
  }

  async function handleSign(signature) {
    setContractError(null);
    try {
      const result = await api.post(`/documents/${pendingContract.documentId}/signatures/${signature.id}/sign`, { signatureMethod: 'link_seguro' });
      setPendingContract((prev) => ({
        ...prev,
        signatures: prev.signatures.map((s) => (s.id === signature.id ? result.signature : s)),
      }));
      if (result.fullySigned) {
        setCreatingContractFor(null);
        setPendingContract(null);
        loadAll();
      }
    } catch (err) {
      setContractError(err instanceof ApiError ? err.message : 'Não foi possível assinar.');
    }
  }

  async function handleCalculate(e) {
    e.preventDefault();
    setCalcError(null);
    if (!calcProfessionalId || !periodStart || !periodEnd) { setCalcError('Escolha o profissional e o período.'); return; }
    setCalculating(true);
    try {
      await api.post(`/commissions/professionals/${calcProfessionalId}/calculate`, { periodStart, periodEnd });
      setPeriodStart(''); setPeriodEnd(''); setCalcProfessionalId('');
      loadAll();
    } catch (err) {
      setCalcError(err instanceof ApiError ? err.message : 'Não foi possível calcular a comissão.');
    } finally {
      setCalculating(false);
    }
  }

  async function handleApprove(payout) {
    setActionError(null);
    try {
      await api.post(`/commissions/${payout.id}/approve`);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível aprovar.');
    }
  }

  function startPaying(payout) {
    setPayingId(payout.id);
    setPayDueDate('');
  }

  async function handlePay(payout) {
    setActionError(null);
    if (!payDueDate) { setActionError('Informe a data de vencimento.'); return; }
    try {
      await api.post(`/commissions/${payout.id}/pay`, { dueDate: payDueDate });
      setPayingId(null);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível gerar o pagamento.');
    }
  }

  return (
    <div>
      <h1>Comissões</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
        Cada profissional precisa de um contrato assinado com o percentual de comissão antes de calcular.
      </p>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 6 }}>Contratos de comissão</h3>
        <p style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 14 }}>{LEGAL_DISCLAIMER}</p>
        {loading ? <p style={{ color: 'var(--muted)' }}>Carregando…</p> : (
          <table>
            <thead><tr><th>Profissional</th><th>Contrato</th><th>Ações</th></tr></thead>
            <tbody>
              {professionals.map((p) => {
                const info = contractInfo[p.id];
                const active = info?.hasContract && info.terms?.remuneration_type === 'comissao_recebimento';
                return (
                  <tr key={p.id}>
                    <td>{p.full_name}</td>
                    <td>
                      {active ? (
                        <span className="badge badge-success">{Number(info.terms.commission_percentage)}% sobre recebimento</span>
                      ) : (
                        <span className="badge badge-neutral">Sem contrato de comissão</span>
                      )}
                    </td>
                    <td>
                      {!active && creatingContractFor !== p.id && (
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startCreatingContract(p)}>Criar contrato</button>
                      )}
                      {creatingContractFor === p.id && !pendingContract && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="number" min="0" max="100" step="0.1" placeholder="% comissão" style={{ width: 90 }}
                            value={commissionPercentage} onChange={(e) => setCommissionPercentage(e.target.value)} />
                          <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleCreateContract(p)}>Criar</button>
                          <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setCreatingContractFor(null)}>X</button>
                        </div>
                      )}
                      {creatingContractFor === p.id && pendingContract && (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          {pendingContract.signatures.map((s) => (
                            <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {s.signer_name} ({s.signer_role}):
                              {s.status === 'assinado' ? (
                                <span className="badge badge-success">Assinado</span>
                              ) : (
                                <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '3px 8px', fontSize: 12 }} onClick={() => handleSign(s)}>Assinar</button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {contractError && creatingContractFor === p.id && <div className="error-banner" style={{ margin: '6px 0 0' }}>{contractError}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 14 }}>Calcular apuração</h3>
        {calcError && <div className="error-banner">{calcError}</div>}
        <form onSubmit={handleCalculate}>
          <div className="card-grid" style={{ marginBottom: 8 }}>
            <div className="field">
              <label>Profissional</label>
              <select value={calcProfessionalId} onChange={(e) => setCalcProfessionalId(e.target.value)}>
                <option value="">Selecione…</option>
                {professionals.filter((p) => contractInfo[p.id]?.hasContract).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div className="field"><label>Início do período</label><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
            <div className="field"><label>Fim do período</label><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={calculating}>{calculating ? 'Calculando…' : 'Calcular comissão'}</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : payouts.length === 0 ? (
          <div className="empty-state"><h2>Nenhuma apuração calculada</h2></div>
        ) : (
          <table>
            <thead><tr><th>Profissional</th><th>Período</th><th>Base</th><th>Comissão</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.professional_name}</td>
                  <td className="mono">{formatDate(p.period_start)} a {formatDate(p.period_end)}</td>
                  <td className="mono">{formatCurrency(p.total_base_amount)}</td>
                  <td className="mono">{formatCurrency(p.total_commission_amount)}</td>
                  <td><span className={statusBadgeClass(p.status)}>{PAYOUT_STATUS_LABELS[p.status] || p.status}</span></td>
                  <td>
                    {p.status === 'calculado' && <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleApprove(p)}>Aprovar</button>}
                    {p.status === 'aprovado' && payingId !== p.id && (
                      <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => startPaying(p)}>Gerar pagamento</button>
                    )}
                    {payingId === p.id && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input type="date" value={payDueDate} onChange={(e) => setPayDueDate(e.target.value)} />
                        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handlePay(p)}>OK</button>
                        <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setPayingId(null)}>X</button>
                      </div>
                    )}
                    {p.status === 'pago' && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>Conta a pagar gerada — finalize no Financeiro</span>}
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
