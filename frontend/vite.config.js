import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, o Vite roda numa porta separada do backend (Express,
// porta 3000). O proxy evita problema de CORS e evita ter que hardcodar a
// URL da API em todo lugar — o frontend chama /api/... como se fosse o
// mesmo servidor, e o Vite encaminha pra http://localhost:3000 por baixo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // Em produção o preview server roda atrás do domínio público do Railway
  // (ex: clinicgest.up.railway.app), não localhost — sem isso o Vite recusa
  // a requisição com "Blocked request. This host is not allowed."
  preview: {
    allowedHosts: true,
  },
});
