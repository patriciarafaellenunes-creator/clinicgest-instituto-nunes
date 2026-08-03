// src/pages/ProntuarioPage.jsx
//
// Fase 1 do prontuário: Anamnese (versionada) e Evolução clínica (cronológica,
// correção sempre encadeada, nunca sobrescreve). Odontograma, periodontograma,
// exames, receitas/atestados e arquivos ficam para uma fase seguinte — o
// backend já cobre tudo isso, mas cada peça merece sua própria tela e
// verificação, em vez de uma só página gigante.

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const RISK_LABELS = { baixo: 'Baixo', moderado: 'Moderado', alto: 'Alto' };

function riskBadgeClass(risk) {
  if (risk === 'alto') return 'badge badge-alert';
  if (risk === 'moderado') return 'badge badge-warn';
  return 'badge badge-success';
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const emptyAnamnesisForm = { chiefComplaint: '', riskClassification: 'baixo', alergias: '', medicamentos: '', habitos: '', clinicalAlerts: '', signedByPatient: false };
const emptyEvolutionForm = { professionalId: '', toothOrRegion: '', description: '', nextStep: '', returnRecommendedDays: '' };

export function ProntuarioPage() {
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [patient, setPatient] = useState(null);

  const [professionals, setProfessionals] = useState([]);
  const [anamnesis, setAnamnesis] = useState(null);
  const [anamnesisHistory, setAnamnesisHistory] = useState([]);
  const [evolutions, setEvolutions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState(null);

  const [showAnamnesisForm, setShowAnamnesisForm] = useState(false);
  const [anamnesisForm, setAnamnesisForm] = useState(emptyAnamnesisForm);
  const [anamnesisError, setAnamnesisError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const [showEvolutionForm, setShowEvolutionForm] = useState(false);
  const [evolutionForm, setEvolutionForm] = useState(emptyEvolutionForm);
  const [evolutionError, setEvolutionError] = useState(null);

  const [correctingId, setCorrectingId] = useState(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionError, setCorrectionError] = useState(null);

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

  async function loadRecord(patientId) {
    setLoading(true);
    setPageError(null);
    try {
      const [current, history, evos] = await Promise.all([
        api.get(`/clinical/patients/${patientId}/anamnesis`),
        api.get(`/clinical/patients/${patientId}/anamnesis/history`),
        api.get(`/clinical/patients/${patientId}/evolutions`),
      ]);
      setAnamnesis(current);
      setAnamnesisHistory(history);
      setEvolutions(evos);
    } catch {
      setPageError('Não foi possível carregar o prontuário deste paciente.');
    } finally {
      setLoading(false);
    }
  }

  function pickPatient(p) {
    setPatient(p);
    setPatientQuery(p.full_name);
    setPatientResults([]);
    setShowAnamnesisForm(false);
    setShowEvolutionForm(false);
    loadRecord(p.id);
  }

  function clearPatient() {
    setPatient(null);
    setPatientQuery('');
    setAnamnesis(null);
    setAnamnesisHistory([]);
    setEvolutions([]);
  }

  function startNewAnamnesisVersion() {
    setAnamnesisError(null);
    setAnamnesisForm({
      chiefComplaint: anamnesis?.chief_complaint || '',
      riskClassification: anamnesis?.risk_classification || 'baixo',
      alergias: anamnesis?.medical_history?.alergias || '',
      medicamentos: Array.isArray(anamnesis?.medical_history?.medicamentos) ? anamnesis.medical_history.medicamentos.join(', ') : '',
      habitos: anamnesis?.medical_history?.habitos || '',
      clinicalAlerts: (anamnesis?.clinical_alerts || []).join('\n'),
      signedByPatient: false,
    });
    setShowAnamnesisForm(true);
  }

  async function handleSaveAnamnesis(e) {
    e.preventDefault();
    setAnamnesisError(null);
    if (!anamnesisForm.chiefComplaint.trim()) { setAnamnesisError('Queixa principal é obrigatória.'); return; }
    try {
      await api.post(`/clinical/patients/${patient.id}/anamnesis`, {
        chiefComplaint: anamnesisForm.chiefComplaint.trim(),
        riskClassification: anamnesisForm.riskClassification,
        medicalHistory: {
          alergias: anamnesisForm.alergias.trim() || null,
          medicamentos: anamnesisForm.medicamentos.split(',').map((s) => s.trim()).filter(Boolean),
          habitos: anamnesisForm.habitos.trim() || null,
        },
        clinicalAlerts: anamnesisForm.clinicalAlerts.split('\n').map((s) => s.trim()).filter(Boolean),
        signedByPatient: anamnesisForm.signedByPatient,
      });
      setShowAnamnesisForm(false);
      loadRecord(patient.id);
    } catch (err) {
      setAnamnesisError(err instanceof ApiError ? err.message : 'Não foi possível salvar a anamnese.');
    }
  }

  async function handleAddEvolution(e) {
    e.preventDefault();
    setEvolutionError(null);
    if (!evolutionForm.professionalId) { setEvolutionError('Selecione o profissional responsável.'); return; }
    if (!evolutionForm.description.trim()) { setEvolutionError('Descrição da evolução é obrigatória.'); return; }
    try {
      await api.post(`/clinical/patients/${patient.id}/evolutions`, {
        professionalId: evolutionForm.professionalId,
        toothOrRegion: evolutionForm.toothOrRegion.trim() || null,
        description: evolutionForm.description.trim(),
        nextStep: evolutionForm.nextStep.trim() || null,
        returnRecommendedDays: evolutionForm.returnRecommendedDays ? Number(evolutionForm.returnRecommendedDays) : null,
      });
      setEvolutionForm(emptyEvolutionForm);
      setShowEvolutionForm(false);
      loadRecord(patient.id);
    } catch (err) {
      setEvolutionError(err instanceof ApiError ? err.message : 'Não foi possível registrar a evolução.');
    }
  }

  function startCorrection(evo) {
    setCorrectingId(evo.id);
    setCorrectionText(evo.description);
    setCorrectionError(null);
  }

  async function handleCorrect(evo) {
    setCorrectionError(null);
    try {
      await api.post(`/clinical/evolutions/${evo.id}/correct`, { description: correctionText.trim() });
      setCorrectingId(null);
      loadRecord(patient.id);
    } catch (err) {
      setCorrectionError(err instanceof ApiError ? err.message : 'Não foi possível corrigir esta evolução.');
    }
  }

  const clinicalAlerts = [];
  if (anamnesis?.clinical_alerts?.length) anamnesis.clinical_alerts.forEach((a) => clinicalAlerts.push(a));
  if (anamnesis?.risk_classification && anamnesis.risk_classification !== 'baixo') {
    clinicalAlerts.push(`Paciente com classificação de risco: ${anamnesis.risk_classification}.`);
  }

  return (
    <div>
      <h1>Prontuário Eletrônico</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
        Anamnese e evolução clínica — dados sensíveis, nada aqui é apagado ou sobrescrito: correções sempre geram um novo registro auditável.
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
        <div className="empty-state"><h2>Busque um paciente para ver o prontuário</h2></div>
      ) : pageError ? (
        <div className="error-banner">{pageError}</div>
      ) : loading ? (
        <p style={{ color: 'var(--muted)' }}>Carregando…</p>
      ) : (
        <>
          {clinicalAlerts.length > 0 && (
            <div className="error-banner" style={{ marginBottom: 20 }}>
              <strong>Alertas clínicos:</strong> {clinicalAlerts.join(' · ')}
            </div>
          )}

          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Anamnese</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {anamnesisHistory.length > 1 && (
                  <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setShowHistory(!showHistory)}>
                    {showHistory ? 'Ocultar histórico' : `Histórico (${anamnesisHistory.length})`}
                  </button>
                )}
                <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={startNewAnamnesisVersion}>
                  {anamnesis ? 'Nova versão' : 'Criar anamnese'}
                </button>
              </div>
            </div>

            {showAnamnesisForm && (
              <form onSubmit={handleSaveAnamnesis} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                {anamnesisError && <div className="error-banner">{anamnesisError}</div>}
                <div className="card-grid" style={{ marginBottom: 8 }}>
                  <div className="field"><label>Queixa principal</label>
                    <input value={anamnesisForm.chiefComplaint} onChange={(e) => setAnamnesisForm((f) => ({ ...f, chiefComplaint: e.target.value }))} /></div>
                  <div className="field"><label>Classificação de risco</label>
                    <select value={anamnesisForm.riskClassification} onChange={(e) => setAnamnesisForm((f) => ({ ...f, riskClassification: e.target.value }))}>
                      <option value="baixo">Baixo</option><option value="moderado">Moderado</option><option value="alto">Alto</option>
                    </select></div>
                  <div className="field"><label>Alergias</label>
                    <input value={anamnesisForm.alergias} onChange={(e) => setAnamnesisForm((f) => ({ ...f, alergias: e.target.value }))} /></div>
                  <div className="field"><label>Medicamentos em uso (separados por vírgula)</label>
                    <input value={anamnesisForm.medicamentos} onChange={(e) => setAnamnesisForm((f) => ({ ...f, medicamentos: e.target.value }))} /></div>
                  <div className="field"><label>Hábitos (bruxismo, tabagismo…)</label>
                    <input value={anamnesisForm.habitos} onChange={(e) => setAnamnesisForm((f) => ({ ...f, habitos: e.target.value }))} /></div>
                  <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                      <input type="checkbox" checked={anamnesisForm.signedByPatient}
                        onChange={(e) => setAnamnesisForm((f) => ({ ...f, signedByPatient: e.target.checked }))} />
                      Paciente assinou a anamnese
                    </label>
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}><label>Alertas clínicos (um por linha — ex: uso de anticoagulante)</label>
                    <textarea rows={2} value={anamnesisForm.clinicalAlerts} onChange={(e) => setAnamnesisForm((f) => ({ ...f, clinicalAlerts: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" type="submit">Salvar como nova versão</button>
                  <button className="btn" type="button" style={{ background: 'transparent', border: '1px solid var(--border-strong)' }} onClick={() => setShowAnamnesisForm(false)}>Cancelar</button>
                </div>
              </form>
            )}

            {!anamnesis ? (
              <p style={{ color: 'var(--muted)' }}>Nenhuma anamnese registrada ainda.</p>
            ) : (
              <div className="card-grid">
                <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Queixa principal</div><div>{anamnesis.chief_complaint || '—'}</div></div>
                <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Risco</div><span className={riskBadgeClass(anamnesis.risk_classification)}>{RISK_LABELS[anamnesis.risk_classification] || anamnesis.risk_classification || '—'}</span></div>
                <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Alergias</div><div>{anamnesis.medical_history?.alergias || '—'}</div></div>
                <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Medicamentos</div><div>{(anamnesis.medical_history?.medicamentos || []).join(', ') || '—'}</div></div>
                <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Hábitos</div><div>{anamnesis.medical_history?.habitos || '—'}</div></div>
                <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Versão</div><div className="mono">v{anamnesis.version} {anamnesis.signed_by_patient ? '· assinada pelo paciente' : '· não assinada'}</div></div>
              </div>
            )}

            {showHistory && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                {anamnesisHistory.filter((h) => !h.is_current).map((h) => (
                  <div key={h.id} style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 6 }}>
                    v{h.version} — {formatDateTime(h.created_at)} — {h.chief_complaint || '—'}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 20px 0' }}>
              <h3 style={{ margin: 0 }}>Evolução clínica</h3>
              <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => setShowEvolutionForm(!showEvolutionForm)}>Novo registro</button>
            </div>

            {showEvolutionForm && (
              <form onSubmit={handleAddEvolution} style={{ padding: 20 }}>
                {evolutionError && <div className="error-banner">{evolutionError}</div>}
                <div className="card-grid" style={{ marginBottom: 8 }}>
                  <div className="field"><label>Profissional</label>
                    <select value={evolutionForm.professionalId} onChange={(e) => setEvolutionForm((f) => ({ ...f, professionalId: e.target.value }))}>
                      <option value="">Selecione…</option>
                      {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select></div>
                  <div className="field"><label>Dente / região</label>
                    <input value={evolutionForm.toothOrRegion} onChange={(e) => setEvolutionForm((f) => ({ ...f, toothOrRegion: e.target.value }))} /></div>
                  <div className="field"><label>Retorno recomendado (dias)</label>
                    <input type="number" min="0" value={evolutionForm.returnRecommendedDays} onChange={(e) => setEvolutionForm((f) => ({ ...f, returnRecommendedDays: e.target.value }))} /></div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}><label>Descrição da evolução</label>
                    <textarea rows={3} value={evolutionForm.description} onChange={(e) => setEvolutionForm((f) => ({ ...f, description: e.target.value }))} /></div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}><label>Próximo passo</label>
                    <input value={evolutionForm.nextStep} onChange={(e) => setEvolutionForm((f) => ({ ...f, nextStep: e.target.value }))} /></div>
                </div>
                <button className="btn btn-primary" type="submit">Registrar evolução</button>
              </form>
            )}

            <div style={{ padding: 20 }}>
              {evolutions.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>Nenhum registro de evolução ainda.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {evolutions.map((ev) => (
                    <div key={ev.id} style={{ borderLeft: '2px solid var(--brand)', paddingLeft: 12 }}>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {formatDateTime(ev.created_at)} · {ev.professional_name}
                        {ev.tooth_or_region && ` · ${ev.tooth_or_region}`}
                        {ev.version > 1 && <span className="badge badge-warn" style={{ marginLeft: 8 }}>correção v{ev.version}</span>}
                      </div>
                      {correctingId === ev.id ? (
                        <div style={{ marginTop: 6 }}>
                          {correctionError && <div className="error-banner">{correctionError}</div>}
                          <textarea rows={3} value={correctionText} onChange={(e) => setCorrectionText(e.target.value)} style={{ width: '100%' }} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => handleCorrect(ev)}>Salvar correção</button>
                            <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '5px 10px' }} onClick={() => setCorrectingId(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ marginTop: 4 }}>{ev.description}</div>
                          {ev.next_step && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Próximo passo: {ev.next_step}</div>}
                          <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '3px 8px', fontSize: 12, marginTop: 6 }} onClick={() => startCorrection(ev)}>
                            Corrigir
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
