// src/pages/DashboardPage.jsx
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [overdue, setOverdue] = useState([]);
  const [overdueLabOrders, setOverdueLabOrders] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [dashboardData, overdueData, overdueLabData] = await Promise.all([
          api.get('/financial/dashboard'),
          api.get('/financial/accounts-receivable/overdue'),
          api.get('/lab-orders/overdue').catch(() => []),
        ]);
        if (cancelled) return;
        setDashboard(dashboardData);
        setOverdue(overdueData);
        setOverdueLabOrders(overdueLabData);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setError('Seu perfil não tem permissão para ver os valores financeiros do painel.');
        } else {
          setError('Não foi possível carregar o painel agora. Tente novamente em instantes.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="empty-state"><p>Carregando painel…</p></div>;
  }

  if (error) {
    return (
      <div className="empty-state">
        <h2>Não deu pra carregar o painel</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Painel</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>Visão geral do dia — financeiro e pendências.</p>

      {overdue.length > 0 && (
        <div className="chart-tab-block">
          <h2>Pacientes inadimplentes ({overdue.length})</h2>
          {overdue.slice(0, 5).map((item) => (
            <div className="alert-row" key={item.id}>
              <span>{item.patient_name}</span>
              <span className="mono">{formatCurrency(item.amount - item.received_amount)} · {item.days_overdue} dias</span>
            </div>
          ))}
          {overdue.length > 5 && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--muted)' }}>
              + {overdue.length - 5} outros pacientes com pendências.
            </p>
          )}
        </div>
      )}

      {overdueLabOrders.length > 0 && (
        <div className="chart-tab-block warn">
          <h2>Próteses/laboratório atrasados ({overdueLabOrders.length})</h2>
          {overdueLabOrders.slice(0, 5).map((item) => (
            <div className="alert-row" key={item.id}>
              <span>{item.patient_name} · {item.work_type} — {item.supplier_name}</span>
              <span className="mono">
                {new Date(item.expected_delivery_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
              </span>
            </div>
          ))}
          {overdueLabOrders.length > 5 && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: 'var(--muted)' }}>
              + {overdueLabOrders.length - 5} outros trabalhos atrasados.
            </p>
          )}
        </div>
      )}

      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-label">Saldo atual</div>
          <div className="stat-value mono">{formatCurrency(dashboard.currentBalance)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Faturamento (período)</div>
          <div className="stat-value mono">{formatCurrency(dashboard.revenueGross)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Recebido (período)</div>
          <div className="stat-value mono positive">{formatCurrency(dashboard.revenueReceived)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">A receber (pendente)</div>
          <div className="stat-value mono">{formatCurrency(dashboard.receivablePending)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Contas vencidas</div>
          <div className="stat-value mono negative">{formatCurrency(dashboard.payableOverdue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Projeção de caixa (30 dias)</div>
          <div className={`stat-value mono ${dashboard.cashProjection30d < 0 ? 'negative' : 'positive'}`}>
            {formatCurrency(dashboard.cashProjection30d)}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Próximos passos</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Este painel usa os mesmos dados que o agente de IA financeiro consulta — nada aqui é estimado, tudo vem
          direto do banco através de <code>financialService</code>.
        </p>
      </div>
    </div>
  );
}
