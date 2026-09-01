-- VAZOU.AI — views de leitura para o dashboard (§6, §11 do PRD)
--
-- Simplificação deliberada de MVP: o PRD (§3.5) descreve `company_daily_metrics`
-- como uma tabela agregada por dia, alimentada por trigger/cron — adequado
-- quando o volume justificar. No MVP, os mesmos números são computados sob
-- demanda por estas views (leitura direta sobre `opportunities`/
-- `recovered_revenue`), o que é suficiente no volume esperado de uma PME e
-- evita construir a infraestrutura de agregação incremental antes de haver
-- necessidade real. Trocar para tabela materializada depois não exige mudar
-- nenhuma tela — só a fonte de leitura.
--
-- `security_invoker = true` garante que a RLS das tabelas de origem seja
-- aplicada com o usuário que consulta a view, não com o dono da view.

create view company_metrics_summary
  with (security_invoker = true)
as
select
  c.id as company_id,
  coalesce(sum(o.potential_value_cents)
    filter (where o.status in ('recuperavel', 'quente', 'morno', 'frio')), 0) as potential_revenue_identified_cents,
  count(*) filter (where o.status in ('recuperavel', 'quente', 'morno', 'frio')) as open_opportunities_count,
  count(*) filter (
    where o.status in ('recuperavel', 'quente', 'morno', 'frio') and o.priority = 'alta'
  ) as high_priority_count,
  count(*) filter (
    where o.status in ('recuperavel', 'quente', 'morno', 'frio')
      and exists (
        select 1 from opportunity_signals s
        where s.opportunity_id = o.id and s.signal_type = 'sem_followup'
      )
  ) as without_followup_count,
  coalesce(avg(o.potential_value_cents)
    filter (where o.potential_value_cents is not null
      and o.status in ('recuperavel', 'quente', 'morno', 'frio')), 0)::bigint as ticket_medio_potential_cents,
  coalesce((
    select sum(r.amount_cents) from recovered_revenue r where r.company_id = c.id
  ), 0) as recovered_revenue_cents,
  count(*) filter (where o.created_at >= now() - interval '7 days') as new_opportunities_7d,
  -- "Revenue Leak Score" (0-100): média do Recovery Score (§7) das
  -- oportunidades ainda ativas. É um AGREGADO da empresa, não o Recovery
  -- Score de uma oportunidade — quanto maior, mais dinheiro de alta
  -- prioridade está parado agora. Heurística simples e documentada aqui
  -- propositalmente, para não ficar escondida numa query da UI.
  round(avg(o.recovery_score)
    filter (where o.status in ('recuperavel', 'quente', 'morno', 'frio')))::int as revenue_leak_score
from companies c
left join opportunities o on o.company_id = c.id
group by c.id;

-- "Onde seu dinheiro está vazando" (§6) — agregação por motivo provável.
create view company_leak_breakdown
  with (security_invoker = true)
as
select
  o.company_id,
  o.probable_reason,
  count(*) as opportunities_count,
  coalesce(sum(o.potential_value_cents), 0) as potential_value_cents
from opportunities o
where o.status in ('recuperavel', 'quente', 'morno', 'frio')
  and o.probable_reason is not null
group by o.company_id, o.probable_reason;
