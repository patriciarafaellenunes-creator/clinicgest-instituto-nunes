// src/api/client.js
//
// Wrapper fino sobre fetch. O token JWT fica em localStorage — isso é uma
// aplicação real rodando no navegador do usuário (não um artifact em
// sandbox), então localStorage é a escolha certa aqui, diferente de
// artifacts do Claude.ai onde isso não seria suportado.

const TOKEN_KEY = 'clinicgest_token';

// Em desenvolvimento, '/api' é redirecionado para o backend local pelo proxy
// do Vite (vite.config.js). Em produção, frontend (Vercel) e backend
// (Railway) vivem em domínios diferentes, então build/deploy precisa
// definir VITE_API_BASE_URL com a URL pública da API (ex:
// https://clinicgest-api.up.railway.app/api).
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new ApiError(data?.error || 'Erro inesperado.', response.status, data?.code);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),

  // Endpoints de autenticação não usam o token (login ainda não existe, bootstrap cria a clínica)
  login: (credentials) => request('/auth/login', { method: 'POST', body: credentials, auth: false }),
  bootstrapClinic: (payload) => request('/auth/bootstrap-clinic', { method: 'POST', body: payload, auth: false }),
};

export { ApiError };
