// src/pages/DocumentosPage.jsx
//
// Central de documentos e contratos (núcleo genérico do documento 3):
// mesma máquina de status/assinatura para contrato de paciente, termo,
// contrato de profissional, laboratório ou fornecedor. Depois que todas as
// assinaturas exigidas são coletadas o documento fica travado — para
// corrigir, é preciso revisar (nova versão), nunca editar o assinado.

import { useEffect, useState } from 'react';
import { api, ApiError, getToken } from '../api/client';

const LEGAL_DISCLAIMER = 'Minutas geradas aqui não têm validade jurídica automática — revisão por advogado é necessária antes do uso definitivo.';

const CATEGORY_LABELS = {
  contrato_paciente: 'Contrato — Paciente',
  termo_paciente: 'Termo de consentimento — Paciente',
  contrato_profissional: 'Contrato — Profissional',
  contrato_fornecedor: 'Contrato — Fornecedor',
  contrato_laboratorio: 'Contrato — Laboratório',
  outro: 'Outro',
};
const PARTY_TYPE_LABELS = { patient: 'Paciente', professional: 'Profissional', supplier: 'Fornecedor', lab: 'Laboratório' };
const STATUS_LABELS = {
  rascunho: 'Rascunho', em_revisao: 'Em revisão', aguardando_aprovacao: 'Aguardando aprovação',
  aguardando_assinatura: 'Aguardando assinatura', parcialmente_assinado: 'Parcialmente assinado',
  assinado: 'Assinado', vigente: 'Vigente', proximo_vencimento: 'Próximo do vencimento',
  vencido: 'Vencido', renovado: 'Renovado', substituido: 'Substituído', cancelado: 'Cancelado', arquivado: 'Arquivado',
};
const MANUAL_TRANSITIONS = ['em_revisao', 'aguardando_aprovacao', 'aguardando_assinatura', 'cancelado', 'arquivado'];

function statusBadgeClass(status) {
  if (['assinado', 'vigente'].includes(status)) return 'badge badge-success';
  if (['cancelado', 'vencido'].includes(status)) return 'badge badge-alert';
  if (['proximo_vencimento', 'parcialmente_assinado', 'aguardando_assinatura'].includes(status)) return 'badge badge-warn';
  return 'badge badge-neutral';
}

function emptySigner() { return { signerName: '', signerRole: '' }; }

export function DocumentosPage() {
  const [documents, setDocuments] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('termo_paciente');
  const [partyType, setPartyType] = useState('patient');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [professionalId, setProfessionalId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [content, setContent] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [signers, setSigners] = useState([emptySigner(), emptySigner()]);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [newStatus, setNewStatus] = useState('');

  async function loadAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [docs, profs, supps] = await Promise.all([
        api.get('/documents'), api.get('/professionals'), api.get('/suppliers'),
      ]);
      setDocuments(docs);
      setProfessionals(profs);
      setSuppliers(supps);
    } catch {
      setPageError('Não foi possível carregar os documentos agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!patientQuery || selectedPatient) { setPatientResults([]); return; }
    const handle = setTimeout(async () => {
      try { setPatientResults(await api.get(`/patients?q=${encodeURIComponent(patientQuery)}`)); }
      catch { setPatientResults([]); }
    }, 250);
    return () => clearTimeout(handle);
  }, [patientQuery, selectedPatient]);

  function resetForm() {
    setCategory('termo_paciente');
    setPartyType('patient');
    setPatientQuery(''); setSelectedPatient(null); setPatientResults([]);
    setProfessionalId(''); setSupplierId('');
    setContent(''); setValidFrom(''); setValidUntil('');
    setSigners([emptySigner(), emptySigner()]);
    setFormError(null);
  }

  function updateSigner(i, patch) { setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s))); }
  function addSigner() { setSigners((prev) => [...prev, emptySigner()]); }
  function removeSigner(i) { setSigners((prev) => prev.filter((_, idx) => idx !== i)); }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    if (!content.trim()) { setFormError('O conteúdo do documento é obrigatório.'); return; }
    if (partyType === 'patient' && !selectedPatient) { setFormError('Selecione o paciente.'); return; }
    if (partyType === 'professional' && !professionalId) { setFormError('Selecione o profissional.'); return; }
    if ((partyType === 'supplier' || partyType === 'lab') && !supplierId) { setFormError('Selecione o fornecedor/laboratório.'); return; }
    const validSigners = signers.filter((s) => s.signerName.trim());
    if (validSigners.length === 0) { setFormError('Adicione ao menos um signatário.'); return; }

    setSubmitting(true);
    try {
      await api.post('/documents', {
        category, partyType,
        patientId: partyType === 'patient' ? selectedPatient.id : undefined,
        professionalId: partyType === 'professional' ? professionalId : undefined,
        supplierId: (partyType === 'supplier' || partyType === 'lab') ? supplierId : undefined,
        content: content.trim(),
        validFrom: validFrom || undefined,
        validUntil: validUntil || undefined,
        signers: validSigners.map((s) => ({ signerName: s.signerName.trim(), signerRole: s.signerRole.trim() || 'signatário' })),
      });
      setShowForm(false);
      resetForm();
      loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar o documento.');
    } finally {
      setSubmitting(false);
    }
  }

  async function openDocument(id) {
    setActionError(null);
    try {
      setSelected(await api.get(`/documents/${id}`));
      setNewStatus('');
    } catch {
      setActionError('Não foi possível abrir este documento.');
    }
  }

  async function handleSign(signature) {
    setActionError(null);
    try {
      await api.post(`/documents/${selected.id}/signatures/${signature.id}/sign`, { signatureMethod: 'link_seguro' });
      openDocument(selected.id);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível assinar.');
    }
  }

  async function handleStatusChange() {
    if (!newStatus) return;
    setActionError(null);
    try {
      await api.post(`/documents/${selected.id}/status`, { status: newStatus });
      setNewStatus('');
      openDocument(selected.id);
      loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mudar o status.');
    }
  }

  async function handleDownloadPdf() {
    setActionError(null);
    try {
      const res = await fetch(`/api/documents/${selected.id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setActionError('Não foi possível gerar o PDF.');
    }
  }

  return (
    <div>
      <h1>Documentos</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 6 }}>Central de contratos e termos — paciente, profissional, fornecedor e laboratório.</p>
      <p style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 20 }}>{LEGAL_DISCLAIMER}</p>

      {pageError && <div className="error-banner">{pageError}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showForm ? 14 : 0 }}>
          <h3 style={{ margin: 0 }}>Documentos</h3>
          <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => { setShowForm(!showForm); resetForm(); }}>Gerar documento</button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} style={{ marginTop: 14, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            {formError && <div className="error-banner">{formError}</div>}
            <div className="card-grid" style={{ marginBottom: 10 }}>
              <div className="field"><label>Categoria</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div className="field"><label>Parte envolvida</label>
                <select value={partyType} onChange={(e) => { setPartyType(e.target.value); setSelectedPatient(null); setPatientQuery(''); setProfessionalId(''); setSupplierId(''); }}>
                  {Object.entries(PARTY_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>

              {partyType === 'patient' && (
                <div className="field" style={{ position: 'relative' }}>
                  <label>Paciente</label>
                  {selectedPatient ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-neutral">{selectedPatient.full_name}</span>
                      <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '3px 8px' }} onClick={() => { setSelectedPatient(null); setPatientQuery(''); }}>Trocar</button>
                    </div>
                  ) : (
                    <input value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} placeholder="Digite o nome…" autoComplete="off" />
                  )}
                  {patientResults.length > 0 && (
                    <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 6, maxHeight: 180, overflowY: 'auto' }}>
                      {patientResults.map((p) => (
                        <div key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setSelectedPatient(p); setPatientQuery(p.full_name); setPatientResults([]); }}
                          style={{ padding: '7px 9px', cursor: 'pointer', borderRadius: 6 }}>{p.full_name}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {partyType === 'professional' && (
                <div className="field"><label>Profissional</label>
                  <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select></div>
              )}
              {(partyType === 'supplier' || partyType === 'lab') && (
                <div className="field"><label>{partyType === 'lab' ? 'Laboratório' : 'Fornecedor'}</label>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}
                  </select></div>
              )}

              <div className="field"><label>Válido a partir de</label><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div>
              <div className="field"><label>Válido até</label><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
            </div>

            <div className="field" style={{ marginBottom: 10 }}>
              <label>Conteúdo</label>
              <textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Texto do contrato ou termo…" />
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Signatários</div>
            {signers.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                <input placeholder="Nome" value={s.signerName} onChange={(e) => updateSigner(i, { signerName: e.target.value })} />
                <input placeholder="Papel (ex: paciente, testemunha)" value={s.signerRole} onChange={(e) => updateSigner(i, { signerRole: e.target.value })} />
                <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 8px' }} onClick={() => removeSigner(i)} disabled={signers.length === 1}>×</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={addSigner}>+ signatário</button>
              <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Salvando…' : 'Gerar documento'}</button>
            </div>
          </form>
        )}
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        {loading ? <div className="empty-state"><p>Carregando…</p></div> : documents.length === 0 ? (
          <div className="empty-state"><h2>Nenhum documento gerado ainda</h2></div>
        ) : (
          <table>
            <thead><tr><th>Categoria</th><th>Parte</th><th>Status</th><th>Pendências</th><th>Válido até</th><th></th></tr></thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{CATEGORY_LABELS[d.category] || d.category}</td>
                  <td>{d.party_name || '—'}</td>
                  <td><span className={statusBadgeClass(d.status)}>{STATUS_LABELS[d.status] || d.status}</span></td>
                  <td>{d.pending_signatures > 0 ? <span className="badge badge-warn">{d.pending_signatures} assinatura(s)</span> : '—'}</td>
                  <td className="mono">{d.valid_until || '—'}</td>
                  <td><button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }} onClick={() => openDocument(d.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          {actionError && <div className="error-banner">{actionError}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0 }}>{CATEGORY_LABELS[selected.category] || selected.category}</h3>
              <span className={statusBadgeClass(selected.status)} style={{ marginTop: 6, display: 'inline-block' }}>{STATUS_LABELS[selected.status] || selected.status}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={handleDownloadPdf}>Baixar PDF</button>
              {!['cancelado', 'arquivado', 'substituido'].includes(selected.status) && (
                <>
                  <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    <option value="">Mudar status…</option>
                    {MANUAL_TRANSITIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                  <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={handleStatusChange} disabled={!newStatus}>Aplicar</button>
                </>
              )}
            </div>
          </div>

          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
            {selected.content}
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Signatários</div>
          <table>
            <thead><tr><th>Nome</th><th>Papel</th><th>Status</th><th>Código de validação</th><th></th></tr></thead>
            <tbody>
              {selected.signatures.map((s) => (
                <tr key={s.id}>
                  <td>{s.signer_name}</td>
                  <td>{s.signer_role}</td>
                  <td>{s.status === 'assinado' ? <span className="badge badge-success">Assinado {s.signed_at ? `em ${new Date(s.signed_at).toLocaleDateString('pt-BR')}` : ''}</span> : <span className="badge badge-neutral">Pendente</span>}</td>
                  <td className="mono">{s.validation_code || '—'}</td>
                  <td>{s.status !== 'assinado' && <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSign(s)}>Assinar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
