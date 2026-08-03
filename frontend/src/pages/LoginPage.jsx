// src/pages/LoginPage.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AMBIGUOUS_EMAIL') {
        setError('Este e-mail existe em mais de uma clínica. Entre em contato com o suporte para identificar a clínica correta.');
      } else if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        setError('E-mail ou senha incorretos.');
      } else {
        setError('Não foi possível entrar. Tente novamente em instantes.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">ClinicGest</div>
        <p className="auth-subtitle">Entre com sua conta para continuar.</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email" type="email" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@suaclinica.com"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password" type="password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="helper-text">
          Ainda não tem uma clínica cadastrada? <Link to="/comecar">Criar clínica</Link>
        </p>
      </div>
    </div>
  );
}
