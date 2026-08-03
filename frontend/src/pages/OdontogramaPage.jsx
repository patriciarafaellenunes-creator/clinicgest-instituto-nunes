// src/pages/OdontogramaPage.jsx
//
// Cada dente/face é versionado no backend (odontogramService) do mesmo jeito
// que a evolução clínica: mudar a condição nunca apaga o registro anterior,
// sempre encadeia. Aqui mostramos só o estado atual + histórico por dente —
// comparação entre duas datas fica para uma fase futura.

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const TEETH_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const TEETH_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const FACES = [
  { value: '', label: 'Dente inteiro' },
  { value: 'oclusal', label: 'Oclusal' },
  { value: 'mesial', label: 'Mesial' },
  { value: 'distal', label: 'Distal' },
  { value: 'vestibular', label: 'Vestibular' },
  { value: 'lingual', label: 'Lingual/Palatina' },
];

// Mesma legenda de src/services/odontogramService.js — é dado de apresentação, não clínico.
const CONDITION_LEGEND = {
  higido: { label: 'Hígido', color: '#ffffff' },
  carie: { label: 'Cárie', color: '#dc2626' },
  restauracao: { label: 'Restauração', color: '#2563eb' },
  coroa: { label: 'Coroa', color: '#ca8a04' },
  implante: { label: 'Implante', color: '#7c3aed' },
  protese: { label: 'Prótese', color: '#0891b2' },
  fratura: { label: 'Fratura', color: '#ea580c' },
  tratamento_endodontico: { label: 'Tratamento endodôntico', color: '#db2777' },
  mobilidade: { label: 'Mobilidade', color: '#65a30d' },
  lesao: { label: 'Lesão', color: '#b91c1c' },
  ausente: { label: 'Ausente', color: '#6b7280' },
  procedimento_indicado: { label: 'Procedimento indicado', color: '#f59e0b' },
};
const CONDITIONS = Object.keys(CONDITION_LEGEND);

function textColorFor(hex) {
  if (hex === '#ffffff') return '#1a1a1a';
  return '#ffffff';
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function OdontogramaPage() {
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [patient, setPatient] = useState(null);

  const [professionals, setProfessionals] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState(null);

  const [openTooth, setOpenTooth] = useState(null);
  const [form, setForm] = useState({ toothCondition: 'carie', face: '', notes: '', professionalId: '' });
  const [formError, setFormError] = useState(null);

  const [historyTooth, setHistoryTooth] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.get('/professionals').then(setProfessionals).catch(() => {});
  }, []);

  useEffect(() => {
    if (!patientQuery || patient) { setPatientResults([]); return; }
    const handle = setTimeout(async () => {
      try { setPatientResults(await api.get(`/patients?q=${encodeURIComponent(patientQuery)}`)); }
      catch { setPatientResults([]); }
    }, 250);
    return () => clearTimeout(handle);
  }, [patientQuery, patient]);

  async function loadOdontogram(patientId) {
    setLoading(true);
    setPageError(null);
    try {
      setEntries(await api.get(`/odontogram/patients/${patientId}`));
    } catch {
      setPageError('Não foi possível carregar o odontograma deste paciente.');
    } finally {
      setLoading(false);
    }
  }

  function pickPatient(p) {
    setPatient(p);
    setPatientQuery(p.full_name);
    setPatientResults([]);
    setOpenTooth(null);
    loadOdontogram(p.id);
  }

  function clearPatient() {
    setPatient(null);
    setPatientQuery('');
    setEntries([]);
    setOpenTooth(null);
  }

  function entriesForTooth(tooth) {
    return entries.filter((e) => String(e.tooth_number) === String(tooth));
  }

  function toothColor(tooth) {
    const teethEntries = entriesForTooth(tooth);
    if (teethEntries.length === 0) return null;
    const wholeTooth = teethEntries.find((e) => !e.face);
    const condition = (wholeTooth || teethEntries[0]).tooth_condition;
    return CONDITION_LEGEND[condition]?.color || null;
  }

  function openPicker(tooth) {
    setOpenTooth(openTooth === tooth ? null : tooth);
    setHistoryTooth(null);
    setFormError(null);
    setForm({ toothCondition: 'carie', face: '', notes: '', professionalId: '' });
  }

  async function handleSaveCondition(tooth) {
    setFormError(null);
    if (!form.professionalId) { setFormError('Selecione o profissional responsável.'); return; }
    try {
      await api.post(`/odontogram/patients/${patient.id}/teeth`, {
        toothNumber: tooth,
        face: form.face || null,
        toothCondition: form.toothCondition,
        notes: form.notes.trim() || null,
        professionalId: form.professionalId,
      });
      setOpenTooth(null);
      loadOdontogram(patient.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar a condição.');
    }
  }

  async function showHistory(entryId, tooth) {
    setHistoryTooth(tooth);
    try {
      setHistory(await api.get(`/odontogram/teeth/${entryId}/history`));
    } catch {
      setHistory([]);
    }
  }

  function renderTooth(tooth, align) {
    const color = toothColor(tooth);
    const teethEntries = entriesForTooth(tooth);
    const popoverSide = align === 'right' ? { right: 0 } : { left: 0 };
    return (
      <div key={tooth} style={{ position: 'relative' }}>
        <button
          onClick={() => openPicker(tooth)}
          title={teethEntries.map((e) => `${e.face || 'dente inteiro'}: ${CONDITION_LEGEND[e.tooth_condition]?.label || e.tooth_condition}`).join(' · ')}
          style={{
            width: 36, height: 36, borderRadius: 6, background: color || 'var(--surface)', color: color ? textColorFor(color) : 'var(--ink)',
            border: '1px solid var(--border-strong)', fontSize: 11, fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {tooth}
        </button>
        {teethEntries.length > 1 && (
          <span style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)' }} />
        )}

        {openTooth === tooth && (
          <div className="card" style={{ position: 'absolute', top: 42, zIndex: 10, padding: 12, width: 260, ...popoverSide }}>
            {formError && <div className="error-banner">{formError}</div>}
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Dente {tooth}</div>

            {teethEntries.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {teethEntries.map((e) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
                    <span>{e.face || 'dente inteiro'}: <strong>{CONDITION_LEGEND[e.tooth_condition]?.label || e.tooth_condition}</strong></span>
                    <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '2px 6px', fontSize: 11 }}
                      onClick={() => showHistory(e.id, tooth)}>Histórico</button>
                  </div>
                ))}
              </div>
            )}

            {historyTooth === tooth && (
              <div style={{ marginBottom: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                {history.map((h) => (
                  <div key={h.id} style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>
                    v{h.version} — {formatDateTime(h.created_at)} — {CONDITION_LEGEND[h.tooth_condition]?.label || h.tooth_condition}{!h.is_current && ' (substituído)'}
                  </div>
                ))}
              </div>
            )}

            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11 }}>Condição</label>
              <select value={form.toothCondition} onChange={(e) => setForm((f) => ({ ...f, toothCondition: e.target.value }))}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LEGEND[c].label}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11 }}>Face</label>
              <select value={form.face} onChange={(e) => setForm((f) => ({ ...f, face: e.target.value }))}>
                {FACES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11 }}>Profissional</label>
              <select value={form.professionalId} onChange={(e) => setForm((f) => ({ ...f, professionalId: e.target.value }))}>
                <option value="">Selecione…</option>
                {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11 }}>Observações</label>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ padding: '5px 10px', flex: 1 }} onClick={() => handleSaveCondition(tooth)}>Salvar</button>
              <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setOpenTooth(null)}>Fechar</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1>Odontograma</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
        Clique em um dente para registrar a condição. Nada é sobrescrito — cada mudança gera uma nova versão, com histórico por dente.
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
        <div className="empty-state"><h2>Busque um paciente para ver o odontograma</h2></div>
      ) : pageError ? (
        <div className="error-banner">{pageError}</div>
      ) : loading ? (
        <p style={{ color: 'var(--muted)' }}>Carregando…</p>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            {CONDITIONS.map((c) => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: CONDITION_LEGEND[c].color, border: '1px solid var(--border-strong)', display: 'inline-block' }} />
                {CONDITION_LEGEND[c].label}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {TEETH_UPPER.map((tooth, i) => renderTooth(tooth, i < TEETH_UPPER.length / 2 ? 'left' : 'right'))}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {TEETH_LOWER.map((tooth, i) => renderTooth(tooth, i < TEETH_LOWER.length / 2 ? 'left' : 'right'))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', marginTop: 10 }}>
            Clique em um dente para registrar ou ver o histórico da condição. O ponto no canto indica mais de um registro (faces diferentes).
          </div>
        </div>
      )}
    </div>
  );
}
