// src/pages/PatientsPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const emptyForm = { fullName: '', cpf: '', phone: '', email: '' };

export function PatientsPage() {
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadPatients(q) {
    setLoading(true);
    try {
      const results = await api.get(`/patients?q=${encodeURIComponent(q || '')}`);
      setPatients(results);
    } catch {
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => loadPatients(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  function updateField(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/patients', form);
      setForm(emptyForm);
      setShowForm(false);
      loadPatients(query);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') {
        setFormError('Já existe um paciente com esse CPF, telefone ou e-mail. Confira antes de cadastrar de novo.');
      } else {
        setFormError(err.message || 'Não foi possível cadastrar o paciente.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1>Pacientes</h1>
          <p style={{ color: 'var(--muted)' }}>Busque por nome, CPF ou telefone.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Novo paciente'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Cadastrar paciente</h3>
          {formError && <div className="error-banner">{formError}</div>}
          <form onSubmit={handleCreate}>
            <div className="card-grid" style={{ marginBottom: 0 }}>
              <div className="field">
                <label htmlFor="fullName">Nome completo</label>
                <input id="fullName" required value={form.fullName} onChange={updateField('fullName')} />
              </div>
              <div className="field">
                <label htmlFor="cpf">CPF</label>
                <input id="cpf" value={form.cpf} onChange={updateField('cpf')} placeholder="000.000.000-00" />
              </div>
              <div className="field">
                <label htmlFor="phone">Telefone</label>
                <input id="phone" value={form.phone} onChange={updateField('phone')} placeholder="(00) 00000-0000" />
              </div>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input id="email" type="email" value={form.email} onChange={updateField('email')} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting} style={{ marginTop: 6 }}>
              {submitting ? 'Salvando…' : 'Salvar paciente'}
            </button>
          </form>
        </div>
      )}

      <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Buscar por nome, CPF ou telefone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state"><p>Buscando…</p></div>
        ) : patients.length === 0 ? (
          <div className="empty-state">
            <h2>Nenhum paciente encontrado</h2>
            <p>{query ? 'Tente outro termo de busca.' : 'Cadastre o primeiro paciente da clínica.'}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Telefone</th>
                <th>E-mail</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id}>
                  <td>{p.full_name}</td>
                  <td className="mono">{p.cpf || '—'}</td>
                  <td className="mono">{p.phone || '—'}</td>
                  <td>{p.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
