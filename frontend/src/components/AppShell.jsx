// src/components/AppShell.jsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Cada item aponta pra um módulo real do backend, com tela própria.
const NAV_SECTIONS = [
  {
    label: 'Operação',
    items: [
      { to: '/', label: 'Painel', end: true },
      { to: '/pacientes', label: 'Pacientes' },
      { to: '/agenda', label: 'Agenda' },
      { to: '/leads', label: 'CRM de Leads' },
      { to: '/orcamentos', label: 'Orçamentos' },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { to: '/financeiro', label: 'Contas e Caixa' },
      { to: '/comissoes', label: 'Comissões' },
      { to: '/agente-financeiro', label: 'Agente de IA' },
    ],
  },
  {
    label: 'Suprimentos',
    items: [
      { to: '/estoque', label: 'Estoque' },
      { to: '/compras', label: 'Compras' },
      { to: '/laboratorios', label: 'Laboratórios / Próteses' },
    ],
  },
  {
    label: 'Prontuário',
    items: [
      { to: '/prontuario', label: 'Prontuário Eletrônico' },
      { to: '/odontograma', label: 'Odontograma' },
      { to: '/planos-tratamento', label: 'Planos de Tratamento' },
    ],
  },
  {
    label: 'Documentos',
    items: [
      { to: '/documentos', label: 'Contratos e Termos' },
      { to: '/agente-documental', label: 'Agente Documental' },
    ],
  },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const initials = user?.id ? user.id.slice(0, 2).toUpperCase() : '??';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Clinic<span>Gest</span></div>
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="dot" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div />
          <div className="topbar-user">
            <span>Clínica {user?.clinicId ? user.clinicId.slice(0, 8) : ''}</span>
            <div className="avatar">{initials}</div>
            <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border-strong)' }} onClick={logout}>
              Sair
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
