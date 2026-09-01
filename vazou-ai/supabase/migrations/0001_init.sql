-- VAZOU.AI — schema inicial do MVP
-- Implementa o modelo descrito em vazou-ai/docs/00-prd-arquitetura.md (§3, §4).
-- Convenções: PKs uuid, valores monetários em centavos (bigint), nada é
-- apagado fisicamente em tabela de negócio (apenas marcado via status).

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────
-- Identidade e tenant
-- ─────────────────────────────────────────────────────────────────────────

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  segment text not null default 'outro'
    check (segment in (
      'clinica', 'odontologia', 'estetica', 'imobiliaria',
      'academia', 'escola', 'servicos_profissionais', 'outro'
    )),
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  plan_id text not null default 'trial',
  status text not null default 'trial'
    check (status in ('trial', 'active', 'suspended', 'canceled')),
  created_at timestamptz not null default now()
);

-- Espelha auth.users — perfil de exibição, nunca dado de autenticação.
create table user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  locale text not null default 'pt-BR',
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('invited', 'active', 'revoked')),
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create index memberships_user_id_idx on memberships (user_id);
create index memberships_company_id_idx on memberships (company_id);

-- O que a IA PODE usar ao gerar mensagem — nunca o contrário (§1.8, §10).
create table business_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  rule_type text not null check (rule_type in (
    'max_discount_pct', 'payment_terms', 'business_hours',
    'brand_voice', 'no_promise_policy', 'custom'
  )),
  value_json jsonb not null default '{}'::jsonb,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index business_rules_company_id_idx on business_rules (company_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Ingestão de dados
-- ─────────────────────────────────────────────────────────────────────────

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  source text not null check (source in ('csv_upload', 'manual_paste')),
  filename text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  row_count integer not null default 0,
  error_log text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index import_batches_company_id_idx on import_batches (company_id);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  external_ref text,
  source text,
  first_contact_at timestamptz,
  created_at timestamptz not null default now()
);

create index contacts_company_id_idx on contacts (company_id);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  import_batch_id uuid references import_batches (id) on delete set null,
  channel text not null default 'manual'
    check (channel in ('whatsapp', 'manual', 'email', 'instagram')),
  started_at timestamptz,
  last_message_at timestamptz,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create index conversations_company_id_idx on conversations (company_id);
create index conversations_contact_id_idx on conversations (contact_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  sender text not null check (sender in ('contact', 'agent')),
  content_text text not null,
  sent_at timestamptz not null default now(),
  sequence_index integer not null default 0
);

create index messages_conversation_id_idx on messages (conversation_id);
create index messages_company_id_idx on messages (company_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Processamento por IA (§10)
-- ─────────────────────────────────────────────────────────────────────────

create table ai_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  job_type text not null check (job_type in ('classify', 'generate_message')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'needs_review')),
  model text,
  prompt_version text,
  input_tokens integer,
  output_tokens integer,
  cost_usd_estimate numeric(10, 6),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_processing_jobs_company_id_idx on ai_processing_jobs (company_id);
create index ai_processing_jobs_status_idx on ai_processing_jobs (status);
create index ai_processing_jobs_conversation_id_idx on ai_processing_jobs (conversation_id);

create table ai_call_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ai_processing_jobs (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  request_summary_json jsonb,
  response_json jsonb,
  created_at timestamptz not null default now()
);

create index ai_call_logs_job_id_idx on ai_call_logs (job_id);
create index ai_call_logs_company_id_idx on ai_call_logs (company_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Oportunidades (núcleo do produto) — §7 Recovery Score
-- ─────────────────────────────────────────────────────────────────────────

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  title text,
  potential_value_cents bigint,
  currency text not null default 'BRL',
  status text not null default 'recuperavel'
    check (status in ('recuperavel', 'quente', 'morno', 'frio', 'perdido', 'convertido')),
  recovery_score integer check (recovery_score between 0 and 100),
  priority text check (priority in ('alta', 'media', 'baixa')),
  probable_reason text check (probable_reason in (
    'sem_followup', 'demora_resposta', 'orcamento_sem_retorno',
    'objecao_preco', 'pedido_parcelamento', 'vai_pensar',
    'pergunta_disponibilidade', 'atendimento_abandonado',
    'intencao_explicita_compra', 'oportunidade_esquecida'
  )),
  next_action_text text,
  score_breakdown_json jsonb,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_company_id_idx on opportunities (company_id);
create index opportunities_contact_id_idx on opportunities (contact_id);
create index opportunities_status_idx on opportunities (company_id, status);
create index opportunities_score_idx on opportunities (company_id, recovery_score desc);

create table opportunity_signals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  signal_type text not null check (signal_type in (
    'sem_followup', 'demora_resposta', 'orcamento_sem_retorno',
    'objecao_preco', 'pedido_parcelamento', 'vai_pensar',
    'pergunta_disponibilidade', 'atendimento_abandonado',
    'intencao_explicita_compra', 'oportunidade_esquecida'
  )),
  detected_at timestamptz not null default now(),
  source_message_id uuid references messages (id) on delete set null,
  confidence text not null default 'media' check (confidence in ('baixa', 'media', 'alta'))
);

create index opportunity_signals_opportunity_id_idx on opportunity_signals (opportunity_id);

create table opportunity_status_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by text not null default 'system', -- uuid de usuário (texto), 'ai' ou 'system'
  reason text,
  created_at timestamptz not null default now()
);

create index opportunity_status_history_opportunity_id_idx on opportunity_status_history (opportunity_id);

create table recovery_messages (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  generated_text text not null,
  tone text,
  generated_by_model text,
  prompt_version text,
  approved_by_user boolean not null default false,
  sent_manually_at timestamptz,
  created_at timestamptz not null default now()
);

create index recovery_messages_opportunity_id_idx on recovery_messages (opportunity_id);

create table recovered_revenue (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'BRL',
  recovered_at timestamptz not null default now(),
  registered_by_user_id uuid references auth.users (id),
  notes text,
  created_at timestamptz not null default now()
);

create index recovered_revenue_company_id_idx on recovered_revenue (company_id);
create index recovered_revenue_opportunity_id_idx on recovered_revenue (opportunity_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Auditoria
-- ─────────────────────────────────────────────────────────────────────────

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'ai')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index audit_log_company_id_idx on audit_log (company_id);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at automático em opportunities
-- ─────────────────────────────────────────────────────────────────────────

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger opportunities_set_updated_at
  before update on opportunities
  for each row execute function set_updated_at();
