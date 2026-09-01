# VAZOU.AI — PRD e Arquitetura do MVP

> Status: rascunho para aprovação. Nenhum código de aplicação foi escrito a
> partir deste documento — é a etapa 1 pedida (PRD, arquitetura, banco de
> dados, fluxos, telas, scoring, multi-tenancy, segurança/LGPD, estrutura de
> chamadas à Claude, custos e backlog). Código só começa após aprovação.
>
> Observação sobre o repositório: este projeto (VAZOU.AI, SaaS de Revenue
> Recovery) é um produto novo e conceitualmente independente do ClinicGest
> (ERP clínico) que já existe neste repositório. Os arquivos ficam isolados
> em `vazou-ai/` para não colidir com o sistema existente. Se a intenção for
> um repositório próprio para o VAZOU.AI, é só avisar.

---

## Sumário executivo

VAZOU.AI é uma plataforma B2B de **Revenue Recovery**: em vez de ser mais um
CRM, ela lê as conversas e dados comerciais que uma empresa já tem, e
transforma isso em uma lista priorizada de dinheiro que está sendo perdido —
com motivo, próxima ação e mensagem de recuperação prontos. A métrica que a
tela inicial precisa responder em 3 segundos é: **quanto dinheiro está
vazando, e quanto já foi recuperado**.

O MVP deliberadamente não tenta ser um CRM completo. Ele é fino, honesto
sobre incerteza (scoring transparente por regras, não “IA mágica”) e cobra
seu valor mostrando receita recuperada de verdade.

---

## 1. PRD completo do MVP

### 1.1 Problema

Empresas que vendem por conversa (WhatsApp, atendimento presencial seguido de
orçamento, etc.) perdem receita de forma invisível: follow-up que não
acontece, orçamento que fica sem resposta, objeção que ninguém volta a
trabalhar. Isso não aparece em nenhum relatório porque não é uma venda
perdida formalmente — é uma venda que simplesmente nunca foi finalizada.
Ferramentas de CRM tradicionais exigem disciplina de uso que esse público
não tem; o dado já existe (nas conversas), só não é analisado.

### 1.2 Proposta de valor

> "Descubra quanto dinheiro sua empresa está deixando escapar — e recupere."

VAZOU.AI se paga sozinho: mostra o valor recuperável antes de qualquer ação,
e o valor efetivamente recuperado depois. O ROI é a própria métrica de
retenção do produto.

### 1.3 Público-alvo (ICP inicial)

PMEs que vendem por conversa e têm ticket médio relevante o suficiente para
follow-up importar: clínicas, consultórios, estética, odontologia,
imobiliárias, academias, escolas, serviços profissionais. Canal comercial
dominante: WhatsApp. Time comercial pequeno (1 a 10 pessoas), sem CRM
robusto ou com um CRM subutilizado.

### 1.4 Persona primária

**Camila, gestora/proprietária.** Não é vendedora, é dona ou administradora.
Olha o negócio de cima, não conversa por conversa. Quer um número (quanto
está sendo perdido), uma lista priorizada (o que atacar primeiro) e prova de
resultado (quanto já recuperou) — não quer operar um funil complexo.

Persona secundária (V1+): **atendente/vendedor**, que efetivamente escreve e
manda a mensagem de recuperação.

### 1.5 Métricas de sucesso

- **North Star:** Receita Recuperada Registrada (R$/mês) por empresa cliente.
- Ativação: empresa importou pelo menos uma leva de conversas e viu a receita
  potencial identificada em menos de 10 minutos após o cadastro.
- Engajamento: % de oportunidades "alta prioridade" com alguma ação tomada
  (mensagem gerada e/ou marcada como trabalhada) em até 48h.
- Confiança no produto (guardrail): taxa de oportunidades marcadas pelo
  usuário como "não é uma oportunidade real" — sinal de falso positivo do
  motor de classificação; se subir, é prioridade corrigir prompt/regras antes
  de qualquer feature nova.
- ROI reportado: recuperado ÷ custo do plano — é o número que justifica a
  renovação.

### 1.6 Escopo funcional do MVP

1. **Autenticação** — cadastro/login (e-mail+senha e, se simples, magic
   link), sessão via Supabase Auth.
2. **Cadastro da empresa** — nome, segmento (clínica, imobiliária, etc. —
   usado para calibrar linguagem da IA), regras comerciais básicas (ver
   §1.8), fuso horário, moeda.
3. **Dashboard** — Receita Potencial Identificada, Recuperado com VAZOU.AI,
   ROI estimado, "onde seu dinheiro está vazando" (motivos agregados),
   radar de oportunidades (lista priorizada), Revenue Leak Score da empresa.
4. **Importação de leads/conversas** — upload de CSV/planilha (nome,
   telefone, canal, texto da conversa ou histórico de mensagens, valor do
   orçamento se houver) e colagem manual de uma conversa avulsa. Sem
   integração automática de canal no MVP (isso é V1, ver §12).
5. **Processamento por IA** — cada conversa importada é classificada de
   forma assíncrona (fila), gerando sinais, motivo provável, Recovery Score
   e status.
6. **Classificação das oportunidades** — nos estados definidos em §1.7 /
   §7.
7. **Cálculo de receita potencial** — valor do orçamento/procedimento
   identificado na conversa ou informado na importação, somado por
   oportunidade aberta (não convertida/perdida).
8. **Ranking de oportunidades** — ordenado por Recovery Score, com filtros
   rápidos (Prioridade alta, Sem follow-up, Orçamentos, Esquecidos — como já
   está na tela de referência).
9. **Página individual da oportunidade** — contato, valor, motivo provável,
   sinais identificados, prioridade, próxima ação recomendada, histórico de
   status, botão "Gerar abordagem".
10. **Geração de mensagem de recuperação** — sob demanda (custo de IA só é
    gasto quando o usuário pede), usando exclusivamente dados da conversa e
    das regras comerciais cadastradas.
11. **Registro de receita recuperada** — o usuário marca manualmente uma
    oportunidade como convertida e informa o valor recebido; isso alimenta o
    ROI. (Conciliação automática via gateway de pagamento é V2.)
12. **Dashboard de ROI** — recuperado vs. potencial identificado, multiplicador
    de ROI (recuperado ÷ custo do plano no período), tendência.

### 1.7 Estados da oportunidade

`convertido`, `quente`, `morno`, `frio`, `perdido`, `recuperável` (ver
detalhamento em §7 — a passagem entre estados é regida pelo Recovery Score
mais eventos explícitos como "marcar como convertido/perdido").

### 1.8 Regras comerciais cadastradas (business rules)

Um pequeno formulário em Configurações onde a empresa registra o que a IA
**pode** usar ao gerar mensagens — nunca o contrário. Exemplos: política de
desconto máximo (se existir), condições de parcelamento padrão, horário de
atendimento, tom de voz da marca (formal/informal). Isso é o que impede a IA
de inventar condição comercial (requisito explícito do briefing).

### 1.9 Fora de escopo do MVP (explícito)

- CRM completo (pipeline kanban configurável, tarefas, automações
  condicionais arbitrárias).
- Qualquer integração automática de canal (WhatsApp Business API, Instagram,
  Gmail, Calendar) — importação é manual/arquivo no MVP.
- Envio automático de mensagens — o MVP **gera** a mensagem, o humano copia e
  envia. Nenhum disparo automático.
- Gateways de pagamento / conciliação financeira automática.
- Agentes autônomos.
- Multi-unidade por empresa (uma empresa = um tenant simples no MVP; ver
  §8 para onde a estrutura já deixa espaço para isso).
- App mobile nativo.

### 1.10 Requisitos não-funcionais

- **Privacidade por padrão**: dado de conversa de terceiros (leads da
  empresa cliente) é tratado como sensível mesmo sem ser dado sensível na
  definição legal estrita — minimização e RLS desde o dia 1 (§8, §9).
  Autenticação de dois fatores é considerada, mas não bloqueante para o MVP:
  entra na Fase 2 de segurança.
- **Latência**: dashboard deve carregar do cache/consulta agregada em <1s
  percebido; processamento de IA é assíncrono e não bloqueia a navegação —
  o usuário importa e continua usando o produto enquanto processa.
- **Transparência**: nenhum número financeiro "estimado" aparece sem
  indicar que é uma estimativa baseada em regras, não uma previsão
  estatística validada (ver §7).
- **Auditabilidade**: toda classificação e toda mensagem gerada por IA fica
  registrada (prompt, versão, tokens) — necessário tanto para depuração
  quanto para LGPD/explicabilidade.

### 1.11 Critérios de aceite do MVP (Definition of Done)

- Uma empresa nova consegue: cadastrar-se → criar a empresa → importar um
  CSV de exemplo → ver a receita potencial identificada e a lista de
  oportunidades priorizada → abrir uma oportunidade → gerar uma mensagem →
  registrar uma receita recuperada → ver o ROI atualizado. Tudo sem suporte
  manual.
- Duas empresas diferentes nunca veem dado uma da outra, inclusive testando
  via chamada direta à API (não só escondendo na tela).
- Nenhuma mensagem gerada pela IA contém preço, desconto ou prazo que não
  esteja explicitamente na conversa ou nas regras comerciais cadastradas —
  validado com um conjunto de casos de teste (golden set).

---

## 2. Arquitetura

### 2.1 Visão em camadas

```
┌───────────────────────────────────────────────────────────────────┐
│  Next.js (App Router) + TypeScript — Vercel                       │
│  Server Components para leitura · Route Handlers para mutações    │
│  e para o webhook/worker de IA · Tailwind CSS                     │
└───────────────┬───────────────────────────────────────────────────┘
                │ supabase-js (client anon key, RLS faz o isolamento)
                │ chamadas server-side com service role (jobs/worker)
┌───────────────▼───────────────────────────────────────────────────┐
│  Supabase                                                          │
│  ├─ Auth (e-mail/senha, magic link, sessão JWT)                   │
│  ├─ Postgres (dados de negócio, RLS por empresa — §8)             │
│  ├─ Storage (arquivos de importação — CSV originais, com          │
│  │            política de acesso por empresa)                     │
│  └─ Edge Functions / Scheduled Functions (fila de processamento)  │
└───────────────┬───────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────────┐
│  Worker de IA (Edge Function ou serviço Node leve, acionado por    │
│  fila baseada em tabela `ai_processing_jobs` + trigger/cron)       │
│  → chama Claude API (classificação e, sob demanda, geração de      │
│    mensagem) — nunca escreve direto no banco sem passar pela       │
│    camada de validação de saída estruturada (§10)                  │
└───────────────┬───────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────────┐
│  Anthropic Claude API                                              │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 Por que essa arquitetura

- **Monólito simples no MVP.** Next.js + Supabase cobre auth, banco,
  storage e função serverless sem precisar orquestrar serviços separados.
  Isso é deliberado para custo e velocidade — não é a arquitetura final,
  é a arquitetura certa para o tamanho do MVP.
- **Processamento de IA é sempre assíncrono e desacoplado da requisição do
  usuário.** Importar um CSV de 200 conversas não pode travar a tela por 3
  minutos esperando 200 chamadas ao Claude. O import cria os registros
  brutos (`conversations`/`messages`) e enfileira jobs (`ai_processing_jobs`
  com status `queued`); um worker processa em lote, com rate limit próprio.
  O usuário navega e vê o dashboard populando progressivamente.
- **A IA nunca escreve "cru" no banco.** Toda saída do Claude passa por um
  validador de schema (JSON estruturado via tool use, §10) antes de virar
  linha em `opportunities`/`opportunity_signals`. Se a saída não bate no
  schema esperado ou fica fora dos limites de confiança, o job é marcado
  como `needs_review` em vez de gravar dado ruim silenciosamente.
- **RLS do Postgres como isolamento primário do multi-tenant**, não apenas
  filtro de aplicação — detalhado em §8.
- **Import por arquivo no MVP, com o "cano" já desenhado para canais ao
  vivo depois.** `import_batches` já tem `source` como enum extensível
  (`csv_upload`, `manual_paste`, e futuramente `whatsapp_business`,
  `gmail`, etc.) e `conversations`/`messages` já são a mesma estrutura que
  um webhook de WhatsApp popularia no futuro — a Fase 2 não exige remodelar
  o núcleo de dados, só adicionar uma nova fonte de entrada (§13, arquitetura
  futura).

### 2.3 Fluxo de dados (importação → dashboard)

```
Upload CSV/colagem
      │
      ▼
import_batches (status=processing)
      │  parse + normalização (contato, conversa, mensagens)
      ▼
contacts / conversations / messages  (dados brutos, minimizados)
      │  para cada conversation nova/alterada
      ▼
ai_processing_jobs (job_type=classify, status=queued)
      │  worker consome a fila, chama Claude com tool use
      ▼
opportunities + opportunity_signals + opportunity_status_history
      │  (agregação incremental, não recomputa tudo a cada leitura)
      ▼
company_daily_metrics (materializado/recalculado por trigger ou cron leve)
      │
      ▼
Dashboard (Server Component lê metrics + opportunities, com RLS aplicado)
```

---

## 3. Modelo do banco de dados

Convenções: toda tabela de negócio tem `company_id uuid not null` e
`created_at timestamptz default now()`; chaves primárias `uuid default
gen_random_uuid()`; valores monetários em **centavos** (`bigint`) para evitar
erro de ponto flutuante; nada é apagado fisicamente em tabela de negócio —
apenas marcado (`status`/`is_deleted`), seguindo o mesmo princípio de
auditabilidade já validado no ClinicGest deste repositório.

O que segue é o **modelo**, não uma migration pronta para rodar — a
implementação (com índices, RLS completo e testes) acontece na fase de
código, após aprovação.

### 3.1 Identidade e tenant

```sql
companies (
  id, name, legal_name, segment,        -- 'clinica','odontologia','estetica',
                                         -- 'imobiliaria','academia','escola',
                                         -- 'servicos_profissionais','outro'
  timezone, currency, plan_id, status,  -- 'trial','active','suspended','canceled'
  created_at
)

user_profiles (               -- espelha auth.users do Supabase
  id,                          -- = auth.users.id
  full_name, avatar_url, locale, created_at
)

memberships (                 -- usuário <-> empresa (N:N, já pronto p/ multi-empresa)
  id, company_id, user_id, role,       -- 'owner','admin','member'
  status,                              -- 'invited','active','revoked'
  invited_by, created_at
)

business_rules (               -- o que a IA PODE usar ao gerar mensagem
  id, company_id, rule_type,   -- 'max_discount_pct','payment_terms',
                                -- 'business_hours','brand_voice','no_promise_policy'
  value_json, description, active, created_at
)
```

### 3.2 Ingestão de dados

```sql
import_batches (
  id, company_id, source,      -- 'csv_upload','manual_paste'
  filename, status,            -- 'pending','processing','completed','failed'
  row_count, error_log, created_by, created_at
)

contacts (
  id, company_id, full_name, phone, email,
  external_ref, source, first_contact_at, created_at
)

conversations (
  id, company_id, contact_id, import_batch_id,
  channel,                     -- 'whatsapp','manual','email','instagram' (futuro)
  started_at, last_message_at, status, created_at
)

messages (
  id, conversation_id, company_id,
  sender,                      -- 'contact','agent'
  content_text, sent_at, sequence_index
)
```

### 3.3 Processamento por IA

```sql
ai_processing_jobs (
  id, company_id, conversation_id, job_type,   -- 'classify','generate_message'
  status,                       -- 'queued','running','done','failed','needs_review'
  model, prompt_version,
  input_tokens, output_tokens, cost_usd_estimate,
  error, created_at, completed_at
)

ai_call_logs (                  -- rastreabilidade/explicabilidade (LGPD)
  id, job_id, company_id,
  request_summary_json, response_json,
  created_at
)
```

### 3.4 Oportunidades (núcleo do produto)

```sql
opportunities (
  id, company_id, contact_id, conversation_id,
  title,                        -- ex: nome do procedimento/produto, se conhecido
  potential_value_cents, currency,
  status,                       -- 'recuperavel','quente','morno','frio',
                                 -- 'perdido','convertido'
  recovery_score int,           -- 0-100, ver §7
  priority,                     -- 'alta','media','baixa'
  probable_reason,              -- enum §1, ex: 'sem_followup','orcamento_sem_retorno'
  next_action_text,
  score_breakdown_json,         -- transparência: cada fator e pontos (§7)
  last_interaction_at,
  created_at, updated_at
)

opportunity_signals (
  id, opportunity_id, signal_type,   -- enum de sinais, ver §7.1
  detected_at, source_message_id, confidence   -- 'baixa','media','alta'
)

opportunity_status_history (
  id, opportunity_id, from_status, to_status,
  changed_by,                   -- user_id, 'ai' ou 'system'
  reason, created_at
)

recovery_messages (
  id, opportunity_id, generated_text, tone,
  generated_by_model, prompt_version,
  approved_by_user boolean, sent_manually_at, created_at
)

recovered_revenue (
  id, opportunity_id, company_id,
  amount_cents, currency, recovered_at,
  registered_by_user_id, notes, created_at
)
```

### 3.5 Métricas e auditoria

```sql
company_daily_metrics (         -- agregação diária, alimenta o dashboard
  company_id, date,
  potential_revenue_identified_cents,
  recovered_revenue_cents,
  roi_multiplier,
  new_opportunities_count,
  opportunities_without_followup_count,
  avg_response_time_minutes,
  ticket_medio_potential_cents,
  revenue_leak_score int         -- 0-100, agregado da empresa (não da oportunidade)
)

audit_log (
  id, company_id, actor_user_id, actor_type,   -- 'user','system','ai'
  action, entity_type, entity_id,
  before_json, after_json, ip, created_at
)
```

### 3.6 Placeholders para arquitetura futura (documentados, não implementados no MVP)

```sql
integrations (
  id, company_id, provider,      -- 'whatsapp_business','instagram','gmail',
                                  -- 'google_calendar','payment_gateway','crm'
  status, credentials_ref,       -- referência a vault, nunca segredo em texto puro
  connected_at
)

notifications ( id, company_id, user_id, type, payload_json, read_at, created_at )
webhook_endpoints ( id, company_id, url, event_types, secret_ref, active )
subscriptions ( id, company_id, plan_id, status, current_period_end, provider_ref )
```

---

## 4. Entidades e relacionamentos

```
companies 1───N memberships N───1 user_profiles
companies 1───N business_rules
companies 1───N import_batches
companies 1───N contacts 1───N conversations 1───N messages
conversations 1───N ai_processing_jobs 1───1 ai_call_logs
contacts 1───N opportunities  (uma oportunidade nasce de um contato/conversa)
conversations 1───N opportunities  (uma conversa pode gerar 1+ oportunidades,
                                     ex: dois procedimentos discutidos)
opportunities 1───N opportunity_signals
opportunities 1───N opportunity_status_history
opportunities 1───N recovery_messages
opportunities 1───N recovered_revenue   (normalmente 1, mas permite parcial)
companies 1───N company_daily_metrics (chave composta company_id+date)
companies 1───N audit_log
```

**Regras de integridade centrais**

- Toda tabela de negócio carrega `company_id` — nenhuma tabela de dado de
  cliente existe sem esse vínculo (impede "esquecer" o isolamento em uma
  tabela nova no futuro).
- `opportunities.potential_value_cents` só é preenchido a partir de dado
  explícito (valor do orçamento na conversa/importação) — nunca inferido
  pela IA a partir de "procedimentos parecidos costumam custar X".
  Se não houver valor explícito, o campo fica nulo e a tela mostra
  "valor não identificado" em vez de estimar.
- `recovery_messages` e `opportunity_signals` sempre referenciam a
  `source_message_id`/conversa de origem — toda afirmação da IA é
  rastreável até o texto que a originou.

---

## 5. Fluxo de usuário

### 5.1 Onboarding (primeira vez)

```
Cadastro (e-mail/senha)
   → Criar empresa (nome, segmento, moeda/fuso)
   → Regras comerciais básicas (opcional, pode pular e preencher depois)
   → Importar primeira leva (CSV modelo disponível para download,
      ou colar uma conversa manualmente)
   → Tela de processamento ("Estamos analisando N conversas...")
   → Dashboard populado com a primeira Receita Potencial Identificada
```

### 5.2 Uso recorrente

```
Login → Dashboard (visão geral do período)
   → Radar de Oportunidades (filtra por prioridade/motivo)
   → Abre uma oportunidade
       → Lê motivo provável + sinais identificados
       → Clica "Gerar abordagem" → recebe mensagem pronta
       → Copia e envia manualmente pelo canal real (WhatsApp, etc.)
       → Volta e, se o cliente responder/fechar, atualiza o status
         (ex: marca como "convertido" e registra o valor recuperado)
   → Nova importação periódica (semanal, por exemplo) traz novas conversas
   → Dashboard de ROI mostra a evolução acumulada
```

### 5.3 Fluxo de registro de receita recuperada

```
Oportunidade em status ativo (recuperavel/quente/morno/frio)
   → Usuário marca "Convertido" → informa valor recebido (pode diferir do
     potencial, ex: fechou com desconto real dado fora do sistema)
   → recovered_revenue recebe o registro
   → company_daily_metrics recalcula ROI do período
```

---

## 6. Mapa de telas

| Tela | MVP? | Descrição |
|---|---|---|
| Login / Cadastro | MVP | E-mail+senha, recuperação de senha |
| Onboarding (criar empresa) | MVP | Nome, segmento, moeda/fuso, regras comerciais |
| **Dashboard** | MVP | Receita Potencial Identificada, Recuperado, ROI, "Onde seu dinheiro está vazando", Radar de Oportunidades (resumo), Revenue Leak Score |
| Importação | MVP | Upload CSV / colar conversa, status do processamento por lote |
| Radar de Oportunidades | MVP | Lista completa, filtros (Todas, Prioridade alta, Sem follow-up, Orçamentos, Esquecidos) |
| Oportunidade (detalhe) | MVP | Contato, valor, motivo, sinais, prioridade, próxima ação, botão "Gerar abordagem", histórico de status |
| Mapa dos Vazamentos | MVP (view derivada do dashboard) | Quebra por motivo de perda, com valor agregado por motivo |
| Registro de receita recuperada | MVP (modal/ação dentro da oportunidade) | Marcar convertido + valor |
| Relatórios | MVP simplificado | Exportação básica (CSV) do que já existe no dashboard; relatórios avançados são V1/V2 |
| Configurações | MVP | Dados da empresa, regras comerciais, usuários/convites básicos |
| Conversas | V1 | Histórico completo de conversas importadas, não só a ligada à oportunidade |
| Copiloto de Recuperação | V1 | Assistente que ajuda a refinar/testar variações da mensagem antes de enviar |
| Pergunte ao Vazou | V1 | Chat de IA somente leitura sobre os próprios dados (ex: "quanto perdi este mês por falta de follow-up?"), no mesmo princípio de grounding do agente financeiro do ClinicGest já existente neste repositório |
| Placar | V1 | Gamificação simples por vendedor/atendente (quem mais recuperou) |
| Notificações | V1 | Alertas de oportunidade nova de alta prioridade, follow-up vencendo |

A tela de referência enviada (print do Dashboard) já reflete fielmente o
MVP: os três números do topo (Receita Potencial, Recuperado, ROI), o bloco
"onde seu dinheiro está vazando", o radar de oportunidades com filtros, e os
indicadores operacionais na base (novas oportunidades, tempo médio de
resposta, sem follow-up, ticket médio, Revenue Leak Score). Isso vira a
referência visual direta de implementação.

---

## 7. Regras do Recovery Score

O Recovery Score é uma **pontuação de 0 a 100 baseada em regras
transparentes e auditáveis** — não uma previsão estatística. Cada
oportunidade mostra na tela o detalhamento de pontos por fator
(`score_breakdown_json`), para que o usuário confie no número por poder
verificá-lo, não por fé. Se não houver dados suficientes (ex: conversa com
uma única mensagem, sem valor identificado), o produto mostra
**"dados insuficientes para calcular prioridade"** em vez de forçar um
número.

### 7.1 Sinais que a IA identifica na conversa

`sem_followup`, `demora_resposta`, `orcamento_sem_retorno`,
`objecao_preco`, `pedido_parcelamento`, `vai_pensar`,
`pergunta_disponibilidade`, `atendimento_abandonado`,
`intencao_explicita_compra`, `oportunidade_esquecida`.

### 7.2 Fatores e pesos (soma máxima = 100)

| Fator | Peso máx. | Critério |
|---|---|---|
| Intenção demonstrada | 25 | Sinal forte (`intencao_explicita_compra`, `pedido_parcelamento`, envio de documento) = 25; sinal moderado (`pergunta_disponibilidade`) = 15; nenhum sinal = 5 |
| Recência da última interação | 20 | ≤2 dias = 20; 3–7 dias = 14; 8–14 dias = 8; >14 dias = 3 |
| Ticket (posição relativa na empresa) | 15 | Top 20% dos valores da empresa = 15; faixa média = 9; faixa baixa = 4 — **relativo à própria empresa**, nunca um valor absoluto cravado, para não fingir uma escala universal que os dados não sustentam |
| Estágio da negociação | 15 | Orçamento/proposta enviada = 15; avaliação em andamento = 10; primeiro contato apenas = 4 |
| Objeção presente | 10 | Objeção contornável (`objecao_preco`, `pedido_parcelamento`, `vai_pensar`) = 10; objeção dura de desistência explícita = 0 (e o status tende a `perdido`, não a `recuperável`); sem objeção registrada = 5 |
| Quantidade de interações | 8 | 3+ interações = 8; 1–2 = 4; 0 (nunca respondeu) = 0 |
| Ausência de follow-up | 7 | Sinal de intenção sem follow-up realizado = 7; follow-up já feito corretamente = 0 |

### 7.3 Faixas de prioridade

| Score | Prioridade |
|---|---|
| ≥ 70 | **Alta** |
| 40–69 | **Média** |
| < 40 | **Baixa** |

### 7.4 Mapeamento para status

O status **não** é só uma leitura direta do score — combina score com
sinais terminais explícitos:

- **Convertido**: só por ação manual do usuário (registro de receita
  recuperada) — a IA nunca marca uma oportunidade como convertida sozinha.
- **Perdido**: manual, ou automático quando há sinal de recusa explícita
  (ex: "não tenho mais interesse") combinado a um período de silêncio
  configurável (padrão sugerido: 30 dias) — sempre reversível pelo usuário.
- **Quente / Morno / Frio**: derivado do score para oportunidades ainda
  ativas (não convertidas/perdidas) — quente ≈ faixa alta, morno ≈ faixa
  média, frio ≈ faixa baixa combinada a recência ruim.
- **Recuperável**: rótulo guarda-chuva usado no dashboard para "tudo que
  ainda tem ação possível" (soma de quente+morno+frio ativos), que é o
  número que compõe a "Receita Potencial Identificada".

### 7.5 Princípio de honestidade estatística

Sem dados suficientes (menos de N interações, ou nenhum valor de orçamento
identificado), o sistema **não apresenta um score como se fosse confiável**
— mostra o que sabe (ex: "orçamento sem valor identificado") e pede o dado
que falta, em vez de estimar. Os pesos acima são o ponto de partida e devem
ser ajustáveis por configuração (não hardcoded no prompt da IA nem espalhados
pelo código), para permitir calibração por segmento no futuro sem reescrever
lógica.

---

## 8. Estrutura de multi-tenancy

- **Modelo**: banco único, schema único, isolamento por `company_id` em
  toda tabela de negócio — mesmo padrão já validado no ClinicGest deste
  repositório (RLS testado ponta a ponta contra Postgres real).
- **Autenticação**: Supabase Auth. Um usuário pode pertencer a mais de uma
  empresa (`memberships`), preparando terreno para agências/consultores que
  atendem várias empresas clientes — sem forçar isso no MVP.
- **RLS (Row-Level Security)** como isolamento primário, não só filtro de
  aplicação. Padrão de política em toda tabela com `company_id`:

  ```sql
  using (
    company_id in (
      select company_id from memberships
      where user_id = auth.uid() and status = 'active'
    )
  )
  with check ( -- mesma condição, impede gravar em empresa que não é sua
    company_id in (
      select company_id from memberships
      where user_id = auth.uid() and status = 'active'
    )
  )
  ```

- **Seleção de empresa ativa** (para usuário multi-empresa): estado do
  cliente (cookie/contexto), não é o que garante segurança — a segurança
  vem do RLS acima; a seleção só decide o que a UI pede para exibir.
- **Storage**: buckets do Supabase Storage com caminho `company_id/...` e
  policy de storage espelhando a policy de tabela.
- **Jobs em background (worker de IA)**: roda com credencial de serviço
  (que faz bypass de RLS por necessidade operacional, como o
  `auth_service_user` já usado no ClinicGest), mas **toda query do worker é
  explicitamente escopada por `company_id`** — nunca uma varredura global
  sem filtro. Isso é regra de código, reforçada por revisão/teste, já que
  aqui o RLS não está protegendo por padrão.
- **Cotas por plano**: limite de conversas processadas/mês e de gerações de
  mensagem por plano, verificado antes de enfileirar um job — evita que uma
  empresa consuma o orçamento de IA de forma desproporcional (proteção de
  custo, não só de dado).
- **Caminho já aberto para multi-unidade**: `companies` hoje é uma unidade
  de negócio única por tenant; se/quando for necessário (ex: uma rede de
  clínicas), o padrão é o mesmo já resolvido no ClinicGest (`company → unit`),
  adicionável sem redesenhar `company_id` como chave de isolamento.

---

## 9. Estratégia de segurança e LGPD

### 9.1 Papéis sob a LGPD

A empresa cliente (ex: a clínica) é a **controladora** dos dados pessoais
dos seus leads/pacientes/clientes. VAZOU.AI é a **operadora**, processando
esses dados exclusivamente para prestar o serviço contratado. Isso precisa
estar em um DPA (contrato de tratamento de dados) padrão assinado com cada
cliente, e os termos de uso do VAZOU.AI precisam deixar isso explícito.

### 9.2 Minimização de dados

- O MVP importa **texto** de conversa — sem mídia/anexos (áudio, imagem,
  documento) na primeira versão, reduzindo superfície de dado sensível.
- Ao montar o prompt para a Claude API, os dados enviados são o mínimo
  necessário: primeiro nome (não nome completo), trecho relevante da
  conversa, valor do orçamento se houver, regras comerciais da empresa.
  Telefone e e-mail completos **não** são enviados à IA — ficam apenas no
  banco, usados só para a interface humana (ex: montar o link de WhatsApp).
- Nenhum dado bancário/financeiro de pagamento é armazenado no MVP (não há
  gateway de pagamento integrado ainda).

### 9.3 Controle de acesso e criptografia

- TLS em trânsito (padrão Vercel/Supabase); criptografia em repouso nativa
  do Postgres gerenciado da Supabase.
- RBAC de aplicação (`owner`/`admin`/`member`) somado a RLS como defesa em
  profundidade — mesmo padrão já adotado e testado no ClinicGest.
- Segredos (chave da Claude API, service role key) apenas em variáveis de
  ambiente do servidor — nunca expostos ao client, nunca commitados.
- 2FA para contas `owner`/`admin`: recomendado a partir da Fase 2 de
  segurança (pós-MVP), não bloqueante para o lançamento inicial.

### 9.4 Auditoria e explicabilidade

- `audit_log` para toda ação sensível (mudança de status, geração de
  mensagem, importação, alteração de regra comercial).
- `ai_call_logs` guarda um resumo de cada chamada à IA (não necessariamente
  o prompt completo com dado pessoal, para não duplicar dado sensível
  desnecessariamente) — suficiente para reconstruir "por que a IA disse
  isso" caso um cliente questione (relevante para o direito de explicação
  sobre decisões automatizadas, art. 20 da LGPD).

### 9.5 Direitos do titular

Como os titulares dos dados (leads/clientes finais) têm relação direta com
a empresa cliente, não com o VAZOU.AI, o canal de exercício de direitos
(acesso, correção, eliminação) passa pela empresa cliente. O VAZOU.AI
disponibiliza, por `company_id`: exportação completa dos dados e exclusão
lógica seguida de expurgo definitivo após o período de retenção.

### 9.6 Retenção e eliminação

Dados de conversas retidos enquanto o contrato estiver ativo + um período
após cancelamento (sugestão inicial: 30 dias, para permitir reativação sem
perda) — depois, exclusão física real, não apenas lógica.

### 9.7 Subprocessadores

Listar explicitamente nos termos: Supabase (hospedagem/banco), Vercel
(hospedagem de frontend), Anthropic (processamento de linguagem natural).
Cada um precisa estar coberto por cláusula de confidencialidade/DPA próprio
antes do GA (general availability).

### 9.8 Antes de produção

Revisão de dependências, teste de penetração básico (ou ao menos scan
automatizado), plano de resposta a incidente com prazo de notificação à
ANPD/titulares (72h como referência de boas práticas), e — igual ao alerta
já registrado no ClinicGest deste repositório — qualquer endpoint de
criação de tenant sem autenticação (bootstrap) precisa de proteção
(rate limit, e-mail de verificação) antes de ir ao ar.

---

## 10. Estrutura das chamadas para Claude

### 10.1 Princípio central

A IA **nunca inventa** fato comercial. Todo prompt de geração inclui uma
instrução explícita e uma lista fechada de fatos permitidos
(`allowed_facts`, extraídos da conversa + das `business_rules` cadastradas).
O modelo é instruído a **citar apenas dessa lista** e a dizer explicitamente
quando uma informação não está disponível, em vez de completá-la.

### 10.2 Dois tipos de chamada

**A) `classify_opportunity`** — automática, disparada pelo worker para toda
conversa nova/atualizada importada.

- Entrada: transcrição da conversa (minimizada, §9.2), metadados do
  contato (primeiro nome, canal), regras comerciais da empresa, catálogo de
  procedimentos/produtos se cadastrado.
- Saída: **estruturada via tool use / JSON Schema** (não texto livre), por
  exemplo:
  ```json
  {
    "signals": ["orcamento_sem_retorno", "pedido_parcelamento"],
    "probable_reason": "orcamento_sem_retorno",
    "potential_value_cents": 350000,
    "score_factors": { "intencao": 25, "recencia": 14, "ticket": 15,
                        "estagio": 15, "objecao": 10, "interacoes": 8,
                        "sem_followup": 7 },
    "recommended_next_action": "Retomar contato",
    "confidence": "alta",
    "needs_human_review": false
  }
  ```
- Se a resposta não validar contra o schema, ou `confidence` vier baixa, o
  job vira `needs_review` em vez de gravar direto — nunca um dado
  duvidoso vira número na tela sem essa marcação.

**B) `generate_recovery_message`** — sob demanda, só quando o usuário clica
"Gerar abordagem" (controle de custo deliberado: não gera mensagem para as
38 oportunidades automaticamente, só para a que o usuário quer agir agora).

- Entrada: dados da oportunidade já classificada, sinais, últimas mensagens
  da conversa, regras comerciais, tom de voz da marca.
- Saída: texto da mensagem + lista de "informações usadas" (para
  transparência na tela — o usuário vê de onde cada afirmação da mensagem
  veio antes de copiar e enviar).
- Restrição explícita no system prompt: nunca criar desconto, prazo,
  condição de pagamento ou preço que não esteja literalmente nos fatos
  permitidos.

### 10.3 Controle de custo e confiabilidade

- **Prompt caching** (recurso nativo da Claude API) para o bloco fixo por
  empresa (regras comerciais, system prompt, catálogo) — que se repete em
  toda chamada de classificação daquela empresa.
- **Modelo**: usar o modelo mais custo-eficiente disponível no momento da
  implementação para classificação em lote (a família mais econômica da
  Claude API), e reservar um modelo mais capaz apenas para a geração de
  mensagem, que é o output que o cliente final vai ler diretamente. Preços e
  nomes exatos de modelo devem ser revisados na implementação (mudam com
  frequência) — os números do §11 usam faixas de preço aproximadas, não um
  modelo específico cravado.
- **Retry com backoff** (até 3 tentativas) em falha de API; falha
  persistente marca o job como `failed` com o erro registrado — nunca cai
  silenciosamente.
- **Versionamento de prompt** (`prompt_version` em todo job/log), permitindo
  comparar qualidade antes/depois de uma mudança de prompt e reverter se
  piorar.
- **Golden set de regressão**: conjunto pequeno de conversas de exemplo com
  sinais/score esperados, rodado antes de qualquer mudança de prompt ir ao
  ar — mesmo espírito dos testes automatizados já usados no ClinicGest para
  os agentes de IA existentes (financeiro/documental).

---

## 11. Custos aproximados de infraestrutura

Estimativas de planejamento, não cotação — para decidir viabilidade, não
para orçamento final. Presumem: ~150 conversas novas classificadas por
empresa/mês e ~60 gerações de mensagem por empresa/mês (uso moderado de uma
PME pequena), preço de IA estimado em ~US$0,25 / milhão de tokens de entrada
e ~US$1,25 / milhão de tokens de saída (faixa de modelo econômico — revisar
no momento da implementação).

| Item | 10 empresas | 100 empresas | 1.000 empresas |
|---|---|---|---|
| Vercel (frontend + functions) | Plano Pro, ~US$20/mês | Pro + uso adicional, ~US$50–150/mês | Enterprise/uso elevado, ~US$500–1.500/mês |
| Supabase (Postgres + Auth + Storage) | Plano Pro, ~US$25/mês | Pro + add-on de compute, ~US$100–250/mês | Compute dedicado/Enterprise, ~US$800–2.500/mês |
| Worker/fila de processamento | Incluído nas Edge Functions | Pode exigir processo dedicado leve (Fly.io/Render), ~US$25–75/mês | Processo dedicado com escala, ~US$150–400/mês |
| Claude API (IA) | ~US$1–10/mês | ~US$15–100/mês | ~US$150–1.000/mês |
| Observabilidade (erros/logs, ex. Sentry) | Plano gratuito/baixo, ~US$0–26/mês | ~US$26–80/mês | ~US$100–300/mês |
| E-mail transacional | Plano gratuito | ~US$20/mês | ~US$100–200/mês |
| **Total aproximado/mês** | **~US$70–130** | **~US$300–700** | **~US$2.000–6.000** |

Leitura importante: o custo de IA é a linha mais previsível e barata do
sistema (classificação em lote é leve); o custo que escala mais rápido é
infraestrutura de banco/compute conforme volume de dado e concorrência —
que é também o motivo de manter o processamento de IA assíncrono e limitado
por cota (§8), para que um cliente com uso muito acima da média não
distorça o custo médio por empresa.

---

## 12. Backlog: MVP, V1 e V2

### MVP (descrito em detalhe em §1.6)

1. Autenticação
2. Cadastro da empresa + regras comerciais básicas
3. Importação por arquivo/colagem
4. Processamento assíncrono por IA (classificação)
5. Cálculo de Recovery Score e receita potencial (§7)
6. Dashboard (Receita Potencial, Recuperado, ROI, Onde está vazando, Radar)
7. Radar de Oportunidades com filtros
8. Página de detalhe da oportunidade
9. Geração de mensagem sob demanda
10. Registro manual de receita recuperada
11. Relatório/exportação simples (CSV)
12. RLS multi-tenant + auditoria básica

### V1 — conectar aos canais reais e reduzir trabalho manual

- Integração com WhatsApp Business Platform (importação automática de
  conversas; envio continua exigindo aprovação humana explícita, nunca
  automático nesta fase).
- Integração com Gmail (relevante para imobiliárias/serviços profissionais
  que vendem por e-mail).
- Integração com Google Calendar (checar disponibilidade real ao sugerir
  "retomar contato" com horário).
- Integração com Instagram (DMs).
- Notificações (e-mail/push) de oportunidade nova de alta prioridade e de
  follow-up vencendo.
- Tela "Conversas" completa (histórico além da oportunidade pontual).
- "Pergunte ao Vazou" — chat de IA somente leitura sobre os próprios dados,
  no mesmo princípio de grounding dos agentes já existentes no ClinicGest.
- "Copiloto de Recuperação" — variações de mensagem, testе A/B simples de
  abordagem.
- "Placar" — gamificação simples por atendente/vendedor.
- Papéis/permissões mais granulares (além de owner/admin/member).
- Billing/assinatura (Stripe) e portal de cobrança.
- Relatórios avançados exportáveis (PDF), filtros por período customizado.

### V2 — automação e inteligência avançada

- Agentes autônomos com aprovação por regras (ex: enviar follow-up
  automaticamente para oportunidades de baixo risco, dentro de limites
  configurados, sempre com trilha de auditoria).
- Gateway de pagamento integrado — conciliação automática de receita
  recuperada (fecha o ciclo hoje manual do §1.6 item 11).
- CRM completo opcional (pipeline configurável, tarefas, automações
  condicionais) para quem já superou o "MVP fino" e quer mais controle.
- Analytics avançado: coortes, benchmark entre empresas do mesmo segmento
  (agregado e anonimizado), previsão de churn de clientes da empresa
  cliente.
- Webhooks de saída para integração com CRMs de terceiros.
- API pública para parceiros/integradores.
- Multi-unidade nativo na UI (a estrutura de dado já comporta, §8).
- App mobile.

---

## Próximo passo

Este documento cobre os 12 itens pedidos. Nenhum código foi escrito. Ficando
aprovado (ou com ajustes apontados), o próximo passo natural é: schema SQL
real + RLS (seguindo o padrão já validado no ClinicGest deste repositório),
scaffold do Next.js, e o primeiro fluxo vertical completo (cadastro →
import → classificação → dashboard) antes de qualquer tela secundária.
