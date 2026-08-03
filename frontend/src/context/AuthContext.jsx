// src/context/AuthContext.jsx
import { createContext, useContext, useState, useCallback } from 'react';
import { api, getToken, setToken, clearToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // No carregamento, se já existe um token salvo, consideramos a pessoa
  // autenticada (o backend valida o token de verdade em cada chamada; se
  // estiver expirado, a primeira chamada à API vai devolver 401 e limpar
  // o token automaticamente — ver api/client.js).
  useState(() => {
    const token = getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({ clinicId: payload.clinicId, id: payload.sub });
      } catch {
        clearToken();
      }
    }
    setReady(true);
  });

  const login = useCallback(async (email, password) => {
    const result = await api.login({ email, password });
    setToken(result.token);
    setUser(result.user);
    return result;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
