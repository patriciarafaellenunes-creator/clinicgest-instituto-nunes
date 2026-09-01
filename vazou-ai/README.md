# VAZOU.AI — MVP

> "Descubra quanto dinheiro sua empresa está deixando escapar — e recupere."

Implementação do MVP descrito em [`docs/00-prd-arquitetura.md`](docs/00-prd-arquitetura.md)
(PRD, arquitetura, modelo de dados, Recovery Score, multi-tenancy, LGPD, custo
de infra e backlog). Leia aquele documento primeiro — este README cobre só
como rodar o código.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS · Supabase (Postgres + Auth
+ RLS) · Anthropic Claude API · Vercel (deploy).

## Setup

1. **Crie um projeto no [Supabase](https://supabase.com)** e rode as
   migrations, em ordem, no SQL Editor (ou via Supabase CLI):

   ```bash
   supabase/migrations/0001_init.sql     # schema (§3 do PRD)
   supabase/migrations/0002_rls.sql      # row level security (§8 do PRD)
   supabase/migrations/0003_views.sql    # views de leitura do dashboard
   ```

2. **Copie `.env.example` para `.env.local`** e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — em
     Project Settings → API do seu projeto Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY` — mesma tela; **nunca** exponha ao client.
   - `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com).
   - `ANTHROPIC_CLASSIFY_MODEL` / `ANTHROPIC_MESSAGE_MODEL` — modelo padrão é
     `claude-opus-5`; ajuste apenas se você, deliberadamente, decidir trocar
     por outro modelo (ver §10.3 do PRD — nunca reduzir por custo sem avaliar
     qualidade primeiro).

3. **Instale e rode:**

   ```bash
   npm install
   npm run dev
   ```

4. Acesse `http://localhost:3000`, crie uma conta, cadastre sua empresa e
   importe a primeira conversa (Importar → "Baixar modelo de exemplo" para
   ver o formato de CSV esperado, ou use "Colar conversa" para um teste
   rápido).

## Testes

```bash
npm test        # vitest — Recovery Score (§7), parser de CSV, utilitários de dinheiro
npm run typecheck
```

Os testes cobrem lógica pura (scoring, parsing) — não exigem Supabase nem
chave da Anthropic. Não há teste de integração contra um Postgres real neste
MVP (diferente do ClinicGest, também neste repositório, que valida RLS
ponta a ponta); é o próximo passo natural antes de produção.

## O que é uma simplificação deliberada de MVP (documentada no código)

- **Processamento de IA é síncrono na própria requisição de import**
  (`lib/ai/processJobs.ts`), não um worker separado por fila/cron. O modelo
  de dados já é o de uma fila real (`ai_processing_jobs`) — trocar para um
  worker de verdade (Vercel Cron batendo em `POST /api/import/process`, que
  já existe e já funciona standalone) é upgrade de infraestrutura de V1, sem
  mudar schema nem lógica de classificação.
- **Uma conversa colada/importada vira uma única mensagem** (sender=`contact`),
  não mensagens individuais com timestamp próprio. Uma integração real de
  canal (WhatsApp Business API, V1) povoa `messages` com granularidade real
  sem precisar mudar o schema.
- **`company_metrics_summary`/`company_leak_breakdown` são views**, computadas
  sob demanda — não a tabela `company_daily_metrics` agregada por dia
  descrita no PRD (§3.5). Suficiente no volume de uma PME pequena; trocar por
  tabela materializada depois não muda nenhuma tela.
- **Custo de plano é um valor fixo por `plan_id`** (`lib/plans.ts`), só para
  calcular o ROI mostrado no dashboard — billing real (Stripe) é item de V1.
- **Um usuário opera uma única empresa por vez** (`lib/company.ts`) — o
  schema já suporta múltiplas empresas por usuário (`memberships`); um
  seletor de empresa ativa é V1.
- **Sem Storage de arquivo bruto**: o CSV é parseado no servidor e descartado
  — só os dados extraídos (contato/conversa/mensagem) são persistidos.

## Segurança

Toda tabela de negócio tem Row Level Security por `company_id`
(`supabase/migrations/0002_rls.sql`) — dois usuários de empresas diferentes
nunca compartilham dado, mesmo por chamada direta à API. O worker de IA usa
a service role key (bypass de RLS) apenas na rota `/api/import/process`
quando chamado por um cron autorizado (`CRON_SECRET`); todo o resto do
sistema opera com a sessão do usuário e RLS ativo. Ver §8/§9 do PRD para a
estratégia completa.
