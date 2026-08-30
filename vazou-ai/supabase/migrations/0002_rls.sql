-- VAZOU.AI — Row Level Security (§8 do PRD)
-- Isolamento primário do multi-tenant: nenhuma leitura/escrita atravessa
-- `company_id` fora das empresas em que o usuário tem `membership` ativa.
-- O worker de IA (server-side) usa a service role key do Supabase, que já
-- tem BYPASSRLS por padrão — por isso todo código do worker DEVE escopar
-- suas próprias queries por company_id explicitamente (é regra de código,
-- não de banco, documentada em §8).

-- Função auxiliar SECURITY DEFINER: evita recursão ao consultar a própria
-- tabela `memberships` de dentro de uma policy sobre `memberships`.
create function is_active_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where company_id = target_company_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- companies
-- ─────────────────────────────────────────────────────────────────────────

alter table companies enable row level security;

-- Qualquer usuário autenticado pode criar uma empresa (fluxo de onboarding,
-- §5.1) — a linha criada não expõe dado de nenhuma outra empresa.
create policy companies_insert_any_authenticated on companies
  for insert
  with check (auth.uid() is not null);

create policy companies_select_member on companies
  for select
  using (is_active_member(id));

create policy companies_update_member on companies
  for update
  using (is_active_member(id))
  with check (is_active_member(id));

-- ─────────────────────────────────────────────────────────────────────────
-- user_profiles — cada usuário só enxerga/edita o próprio perfil
-- ─────────────────────────────────────────────────────────────────────────

alter table user_profiles enable row level security;

create policy user_profiles_self on user_profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- memberships
-- ─────────────────────────────────────────────────────────────────────────

alter table memberships enable row level security;

create policy memberships_select_own_company on memberships
  for select
  using (is_active_member(company_id) or user_id = auth.uid());

-- Bootstrap: um usuário só pode criar uma membership PARA SI MESMO, e só
-- como 'owner' quando a empresa ainda não tem nenhum membro (evita que
-- qualquer pessoa se autoadicione a uma empresa alheia). Convites (V1)
-- exigirão uma rota de servidor dedicada, não INSERT direto do client.
create policy memberships_insert_bootstrap_owner on memberships
  for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (
      select 1 from memberships m2 where m2.company_id = memberships.company_id
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Tabelas com company_id direto: policy padrão (§8)
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  tenant_tables text[] := array[
    'business_rules', 'import_batches', 'contacts', 'conversations',
    'messages', 'ai_processing_jobs', 'ai_call_logs', 'opportunities',
    'recovered_revenue', 'audit_log'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy %I_member_all on %I
         for all
         using (is_active_member(company_id))
         with check (is_active_member(company_id));',
      t, t
    );
  end loop;
end $$;

-- ai_call_logs contém detalhe de chamadas de IA (explicabilidade/LGPD) —
-- leitura permitida a membros, mas nunca escrita pelo client (só pelo
-- worker via service role, que faz bypass de RLS).
drop policy ai_call_logs_member_all on ai_call_logs;
create policy ai_call_logs_select_member on ai_call_logs
  for select
  using (is_active_member(company_id));

-- audit_log é append-only para o client: membros podem ler, mas não
-- alterar/apagar (escrita normal acontece via server actions/rotas).
drop policy audit_log_member_all on audit_log;
create policy audit_log_select_member on audit_log
  for select
  using (is_active_member(company_id));
create policy audit_log_insert_member on audit_log
  for insert
  with check (is_active_member(company_id));

-- ─────────────────────────────────────────────────────────────────────────
-- Tabelas filhas de `opportunities` (sem company_id próprio) — isolam via
-- join na oportunidade dona.
-- ─────────────────────────────────────────────────────────────────────────

alter table opportunity_signals enable row level security;
create policy opportunity_signals_member_all on opportunity_signals
  for all
  using (
    exists (
      select 1 from opportunities o
      where o.id = opportunity_signals.opportunity_id
        and is_active_member(o.company_id)
    )
  )
  with check (
    exists (
      select 1 from opportunities o
      where o.id = opportunity_signals.opportunity_id
        and is_active_member(o.company_id)
    )
  );

alter table opportunity_status_history enable row level security;
create policy opportunity_status_history_member_all on opportunity_status_history
  for all
  using (
    exists (
      select 1 from opportunities o
      where o.id = opportunity_status_history.opportunity_id
        and is_active_member(o.company_id)
    )
  )
  with check (
    exists (
      select 1 from opportunities o
      where o.id = opportunity_status_history.opportunity_id
        and is_active_member(o.company_id)
    )
  );

alter table recovery_messages enable row level security;
create policy recovery_messages_member_all on recovery_messages
  for all
  using (
    exists (
      select 1 from opportunities o
      where o.id = recovery_messages.opportunity_id
        and is_active_member(o.company_id)
    )
  )
  with check (
    exists (
      select 1 from opportunities o
      where o.id = recovery_messages.opportunity_id
        and is_active_member(o.company_id)
    )
  );
