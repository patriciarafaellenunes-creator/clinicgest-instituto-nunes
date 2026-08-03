// src/pages/AgendaPage.jsx
//
// A API de agenda é por profissional + data (GET /api/agenda/professional/:id?date=...)
// — não existe um "ver tudo" — então a tela sempre parte de "qual profissional,
// qual dia". Isso bate com como uma clínica pequena realmente organiza a agenda
// (a recepção olha a grade de cada dentista, não uma lista misturada).

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const STATUS_LABELS = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  em_espera: 'Em espera',
  em_atendimento: 'Em atendimento',
  finalizado: 'Finalizado',
  reagendado: 'Reagendado',
  cancelado: 'Cancelado',
  faltou: 'Faltou',
};
const VALID_STATUSES = Object.keys(STATUS_LABELS);
const TERMINAL_STATUSES = ['finalizado'];
const REASON_REQUIRED = ['cancelado', 'faltou'];

function statusBadgeClass(status) {
  if (['finalizado', 'confirmado'].includes(status)) return 'badge badge-success';
  if (['cancelado', 'faltou'].includes(status)) return 'badge badge-alert';
  if (['agendado', 'em_espera', 'em_atendimento'].includes(status)) return 'badge badge-warn';
  return 'badge badge-neutral';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const emptyForm = { patientQuery: '', patientId: null, patientName: '', procedureId: '', newProcedureName: '', date: todayStr(), time: '09:00', duration: '30' };

export function AgendaPage() {
  const [professionals, setProfessionals] = useState([]);
  const [units, setUnits] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [patientResults, setPatientResults] = useState([]);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [profs, unitList, procs] = await Promise.all([
          api.get('/professionals'),
          api.get('/units'),
          api.get('/procedures'),
        ]);
        setProfessionals(profs);
        setUnits(unitList);
        setProcedures(procs);
        if (profs.length > 0) setProfessionalId(profs[0].id);
      } catch (err) {
        setPageError('Não foi possível carregar profissionais/unidades. Tente recarregar a página.');
      }
    })();
  }, []);

  async function loadAppointments() {
    if (!professionalId) return;
    setLoading(true);
    setPageError(null);
    try {
      const rows = await api.get(`/agenda/professional/${professionalId}?date=${date}`);
      setAppointments(rows);
    } catch (err) {
      setPageError('Não foi possível carregar a agenda desse dia.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAppointments(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [professionalId, date]);

  useEffect(() => {
    if (!form.patientQuery || form.patientId) { setPatientResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const results = await api.get(`/patients?q=${encodeURIComponent(form.patientQuery)}`);
        setPatientResults(results);
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

  function clearPatient() {
    setForm((f) => ({ ...f, patientId: null, patientName: '', patientQuery: '' }));
  }

  async function handleChangeStatus(appointment, newStatus) {
    setActionError(null);
    let cancelReason;
    if (REASON_REQUIRED.includes(newStatus)) {
      cancelReason = window.prompt(`Motivo (${STATUS_LABELS[newStatus].toLowerCase()}):`, '') || '';
      if (cancelReason.trim() === '') return; // usuário cancelou o prompt — não muda nada
    }
    try {
      await api.post(`/agenda/${appointment.id}/status`, { status: newStatus, cancelReason });
      loadAppointments();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mudar o status.');
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);

    if (!form.patientId) { setFormError('Selecione um paciente cadastrado (busque pelo nome).'); return; }
    if (units.length === 0) { setFormError('Nenhuma unidade cadastrada nesta clínica ainda.'); return; }
    if (!form.procedureId && !form.newProcedureName.trim()) { setFormError('Escolha um procedimento ou digite o nome de um novo.'); return; }

    setSubmitting(true);
    try {
      let procedureId = form.procedureId;
      if (!procedureId && form.newProcedureName.trim()) {
        const created = await api.post('/procedures', { name: form.newProcedureName.trim() });
        procedureId = created.id;
        setProcedures((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      }

      const startsAt = new Date(`${form.date}T${form.time}:00`);
      const endsAt = new Date(startsAt.getTime() + Number(form.duration) * 60000);

      await api.post('/agenda', {
        unitId: units[0].id,
        patientId: form.patientId,
        professionalId,
        procedureId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });

      setForm({ ...emptyForm, date: form.date });
      setShowForm(false);
      if (form.date === date) loadAppointments();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError(err.message); // conflito de horário — mensagem do backend já é clara
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Não foi possível criar o agendamento.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>Agenda</h1>
          <p style={{ color: 'var(--muted)' }}>Veja e marque atendimentos por profissional e dia.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)} disabled={!professionalId}>
          {showForm ? 'Cancelar' : '+ Novo agendamento'}
        </button>
      </div>

      {pageError && <div className="error-banner">{pageError}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="card-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 20 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="professional">Profissional</label>
          <select id="professional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            {professionals.length === 0 && <option value="">Nenhum profissional cadastrado</option>}
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="date">Dia</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Novo agendamento</h3>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="field" style={{ position: 'relative' }}>
              <label htmlFor="patientQuery">Paciente</label>
              {form.patientId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge badge-neutral">{form.patientName}</span>
                  <button type="button" className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)', padding: '4px 10px' }} onClick={clearPatient}>
                    Trocar
                  </button>
                </div>
              ) : (
                <input
                  id="patientQuery"
                  placeholder="Digite o nome do paciente…"
                  value={form.patientQuery}
                  onChange={updateField('patientQuery')}
                  autoComplete="off"
                />
              )}
              {patientResults.length > 0 && (
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {patientResults.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => pickPatient(p)}
                      style={{ padding: '8px 10px', cursor: 'pointer', borderRadius: 6 }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {p.full_name} {p.cpf && <span className="mono" style={{ color: 'var(--muted)' }}>· {p.cpf}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 0, marginTop: 4 }}>
              <div className="field">
                <label htmlFor="procedureId">Procedimento</label>
                <select id="procedureId" value={form.procedureId} onChange={(e) => setForm((f) => ({ ...f, procedureId: e.target.value, newProcedureName: '' }))}>
                  <option value="">Selecione…</option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="">+ Novo procedimento (digite abaixo)</option>
                </select>
              </div>
              {!form.procedureId && (
                <div className="field">
                  <label htmlFor="newProcedureName">Nome do novo procedimento</label>
                  <input id="newProcedureName" value={form.newProcedureName} onChange={updateField('newProcedureName')} placeholder="Ex.: Retorno, Cirurgia, Avaliação…" />
                </div>
              )}
            </div>

            <div className="card-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 0, marginTop: 4 }}>
              <div className="field">
                <label htmlFor="formDate">Data</label>
                <input id="formDate" type="date" value={form.date} onChange={updateField('date')} required />
              </div>
              <div className="field">
                <label htmlFor="formTime">Horário</label>
                <input id="formTime" type="time" value={form.time} onChange={updateField('time')} required />
              </div>
              <div className="field">
                <label htmlFor="duration">Duração</label>
                <select id="duration" value={form.duration} onChange={updateField('duration')}>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">1 hora</option>
                  <option value="90">1h30</option>
                  <option value="120">2 horas</option>
                </select>
              </div>
            </div>

            <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginTop: 6 }}>
              {submitting ? 'Salvando…' : 'Agendar'}
            </button>
          </form>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state"><p>Carregando agenda…</p></div>
        ) : appointments.length === 0 ? (
          <div className="empty-state">
            <h2>Nenhum atendimento nesse dia</h2>
            <p>Escolha outro dia ou marque um novo agendamento.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Horário</th>
                <th>Paciente</th>
                <th>Procedimento</th>
                <th>Status</th>
                <th>Mudar status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{formatTime(a.starts_at)}</td>
                  <td>{a.patient_name || a.lead_name || '—'}</td>
                  <td>{a.procedure_name || '—'}</td>
                  <td><span className={statusBadgeClass(a.status)}>{STATUS_LABELS[a.status] || a.status}</span></td>
                  <td>
                    {TERMINAL_STATUSES.includes(a.status) ? (
                      <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>—</span>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) handleChangeStatus(a, e.target.value); }}
                      >
                        <option value="">Selecionar…</option>
                        {VALID_STATUSES.filter((s) => s !== a.status).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
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
