// src/App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { BootstrapPage } from './pages/BootstrapPage';
import { DashboardPage } from './pages/DashboardPage';
import { PatientsPage } from './pages/PatientsPage';
import { AgendaPage } from './pages/AgendaPage';
import { LeadsPage } from './pages/LeadsPage';
import { OrcamentosPage } from './pages/OrcamentosPage';
import { FinanceiroPage } from './pages/FinanceiroPage';
import { EstoquePage } from './pages/EstoquePage';
import { ComprasPage } from './pages/ComprasPage';
import { LaboratoriosPage } from './pages/LaboratoriosPage';
import { ComissoesPage } from './pages/ComissoesPage';
import { ProntuarioPage } from './pages/ProntuarioPage';
import { OdontogramaPage } from './pages/OdontogramaPage';
import { PlanosTratamentoPage } from './pages/PlanosTratamentoPage';
import { DocumentosPage } from './pages/DocumentosPage';
import { AgenteFinanceiroPage } from './pages/AgenteFinanceiroPage';
import { AgenteDocumentalPage } from './pages/AgenteDocumentalPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/comecar" element={<BootstrapPage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/pacientes" element={<PatientsPage />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/orcamentos" element={<OrcamentosPage />} />
            <Route path="/financeiro" element={<FinanceiroPage />} />
            <Route path="/estoque" element={<EstoquePage />} />
            <Route path="/compras" element={<ComprasPage />} />
            <Route path="/laboratorios" element={<LaboratoriosPage />} />
            <Route path="/comissoes" element={<ComissoesPage />} />
            <Route path="/prontuario" element={<ProntuarioPage />} />
            <Route path="/odontograma" element={<OdontogramaPage />} />
            <Route path="/planos-tratamento" element={<PlanosTratamentoPage />} />
            <Route path="/documentos" element={<DocumentosPage />} />
            <Route path="/agente-financeiro" element={<AgenteFinanceiroPage />} />
            <Route path="/agente-documental" element={<AgenteDocumentalPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
