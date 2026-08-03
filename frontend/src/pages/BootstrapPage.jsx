// src/pages/BootstrapPage.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const initialForm = {
  companyLegalName: '',
  clinicName: '',
  unitName: '',
  ownerFullName: '',
  ownerEmail: '',
  ownerPassword: '',
};

export function BootstrapPage() {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.bootstrapClinic(form);
      // Depois de criar a clínica, já loga automaticamente — evita a pessoa
      // ter que digitar a senha duas vezes em sequência.
      await login(form.ownerEmail, form.ownerPassword);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Não foi possível criar a clínica. Confira os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <div className="auth-brand">Criar sua clínica</div>
        <p className="auth-subtitle">
          Isso cria sua clínica, a primeira unidade e o seu usuário como proprietário, com acesso completo ao sistema.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="companyLegalName">Razão social</label>
            <input id="companyLegalName" required value={form.companyLegalName} onChange={update('companyLegalName')} placeholder="Sua Clínica LTDA" />
          </div>
          <div className="field">
            <label htmlFor="clinicName">Nome da clínica</label>
            <input id="clinicName" required value={form.clinicName} onChange={update('clinicName')} placeholder="Sua Clínica" />
          </div>
          <div className="field">
            <label htmlFor="unitName">Nome da primeira unidade (opcional)</label>
            <input id="unitName" value={form.unitName} onChange={update('unitName')} placeholder="Unidade Principal" />
          </div>
          <div className="field">
            <label htmlFor="ownerFullName">Seu nome</label>
            <input id="ownerFullName" required value={form.ownerFullName} onChange={update('ownerFullName')} placeholder="Seu nome completo" />
          </div>
          <div className="field">
            <label htmlFor="ownerEmail">Seu e-mail</label>
            <input id="ownerEmail" type="email" required value={form.ownerEmail} onChange={update('ownerEmail')} placeholder="voce@suaclinica.com" />
          </div>
          <div className="field">
            <label htmlFor="ownerPassword">Senha (mínimo 8 caracteres)</label>
            <input id="ownerPassword" type="password" required minLength={8} value={form.ownerPassword} onChange={update('ownerPassword')} placeholder="••••••••" />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Criando…' : 'Criar clínica e entrar'}
          </button>
        </form>

        <p className="helper-text">
          Já tem uma conta? <Link to="/entrar">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
