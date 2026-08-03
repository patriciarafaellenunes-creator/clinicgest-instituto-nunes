# ClinicGest — Plataforma Integrada de Gestão de Clínicas com Agente Financeiro de IA
### Plano Mestre — Visão Geral, Arquitetura e Roadmap

> Este documento cobre o que foi pedido na seção 27 do briefing: visão geral, arquitetura, mapa de telas, fluxos, banco de dados, perfis/permissões, regras de negócio, automações, indicadores, dashboard, plano de desenvolvimento, MVP, etapas futuras, testes, segurança, backup e exemplos do agente financeiro.
>
> **Escopo real:** o que foi especificado nos três documentos (financeiro/BPO, prontuário eletrônico, contratos/assinatura) equivale a um ERP clínico completo — dezenas de módulos, com exigências sérias de segurança e conformidade (LGPD, prontuário, assinatura eletrônica). Não é algo que se constrói de forma confiável em uma única entrega. Este plano define a arquitetura completa e prioriza um **MVP funcional real**, que já entrego como código (schema de banco + estrutura de backend) junto com este plano. Os módulos avançados (prontuário completo, contratos/assinatura, laboratórios, IA preditiva) ficam nas Fases 2 e 3, descritas abaixo.

---

## 1. Visão geral do sistema

ClinicGest é uma plataforma multi-tenant (multi-clínica, multi-unidade, multi-CNPJ) organizada em quatro camadas:

1. **Camada operacional** — agenda, pacientes, leads/CRM, orçamentos.
2. **Camada financeira** — contas a pagar/receber, fluxo de caixa, conciliação, DRE, comissões.
3. **Camada clínica** — prontuário, odontograma, planos de tratamento, evolução (Fase 2, por exigir mais controles de segurança/auditoria antes de ir ao ar).
4. **Camada de inteligência** — agente de IA (BPO financeiro + documental), dashboards, indicadores.

Todas as camadas compartilham o mesmo modelo de identidade (empresa → clínica → unidade → usuário → perfil) e o mesmo barramento de auditoria.

---

## 2. Arquitetura recomendada

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Web responsivo + futura versão mobile)            │
│  React/Next.js · Design system próprio · PWA                 │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS / REST + WebSocket (notificações)
┌───────────────▼─────────────────────────────────────────────┐
│  API Gateway (auth, rate limit, roteamento)                  │
└───────────────┬─────────────────────────────────────────────┘
                │
   ┌────────────┼──────────────┬───────────────┬──────────────┐
   ▼            ▼              ▼               ▼              ▼
Serviço      Serviço        Serviço         Serviço        Serviço
Core/Auth    Agenda/CRM     Financeiro      Estoque/       Documentos/
(usuários,   (leads,        (contas,        Compras        Contratos/
clínicas,    agendamentos,  caixa, DRE,                    Assinatura
permissões)  orçamentos)    comissões)                     (Fase 2)
   │            │              │               │              │
   └────────────┴──────┬───────┴───────────────┴──────────────┘
                        ▼
              PostgreSQL (dados relacionais, multi-tenant por clinic_id)
                        │
        ┌───────────────┼────────────────┐
        ▼                                 ▼
  Object Storage                    Fila de eventos
  (documentos, fotos,               (automações, notificações,
   exames, contratos)                agente de IA, webhooks)
                        │
                        ▼
              Agente de IA (camada de orquestração)
              — só lê dados via API/serviço financeiro,
                nunca acessa o banco diretamente
```

**Por que essa arquitetura:**
- **Monólito modular no MVP, com fronteiras de serviço já definidas.** Começar com microsserviços de verdade adicionaria complexidade operacional sem necessidade agora; mas separar os módulos internamente (cada um com seu schema/tabelas e API interna clara) permite migrar para serviços independentes depois, sem reescrever regras de negócio.
- **PostgreSQL** como banco único no MVP: suporta bem multi-tenancy por `clinic_id` + row-level security, transações ACID (essencial para financeiro), e JSON para campos flexíveis (ex: campos dinâmicos por especialidade, seção 7 do documento de contratos).
- **Fila de eventos** (ex: uma tabela `outbox` + worker, evoluindo para algo como Redis/BullMQ) para automações e para o agente de IA nunca bloquear uma transação financeira.
- **O agente de IA nunca escreve diretamente no banco.** Ele só lê via uma camada de consulta controlada e só executa ações sensíveis (excluir, alterar, mover dinheiro) através de uma fila de aprovação humana — isso é uma exigência de segurança, não só do briefing.

---

## 3. Mapa de telas (alto nível)

| Área | Telas principais |
|---|---|
| **Acesso** | Login, seleção de clínica/unidade, recuperação de senha, 2FA |
| **Dashboard** | Painel executivo com filtros (período, unidade, profissional, etc.) |
| **Agenda** | Visão dia/semana/mês, por profissional/sala, lista de espera, encaixes |
| **Pacientes** | Lista, ficha completa, histórico, documentos |
| **CRM/Leads** | Funil kanban, ficha do lead, tarefas de follow-up |
| **Orçamentos** | Criação, versões, aprovação, conversão em contrato |
| **Financeiro** | Contas a pagar, contas a receber, fluxo de caixa, conciliação, DRE |
| **Estoque** | Itens, movimentações, compras, fichas técnicas por procedimento |
| **Equipe** | Profissionais, diárias, comissões |
| **Relatórios** | Central de relatórios com filtros e exportação |
| **Configurações** | Empresas/clínicas/unidades, perfis e permissões, categorias, automações |
| **Agente IA** | Chat financeiro + painel de alertas/recomendações |

---

## 4. Fluxos principais de usuário

**Fluxo comercial (lead → paciente):**
Lead entra (CRM) → primeiro contato → avaliação agendada (Agenda) → avaliação realizada → orçamento criado → orçamento aprovado → gera contrato + parcelas (Financeiro) + plano de tratamento (Prontuário, Fase 2) → agendamento dos procedimentos.

**Fluxo financeiro diário:**
Recepção lança pagamento/recebimento → sistema classifica automaticamente (categoria/centro de custo) → conciliação com extrato/operadora → agente de IA sinaliza divergências e atualiza fluxo de caixa projetado → gestor recebe resumo diário.

**Fluxo de conta a pagar:**
Fornecedor/despesa cadastrada → lançamento com vencimento → aprovação (se acima de alçada) → pagamento → baixa → reflexo automático no DRE e no fluxo de caixa.

---

## 5. Estrutura do banco de dados (modelo relacional)

Entidades centrais e relacionamentos-chave (MVP em negrito; Fase 2/3 em itálico):

- **companies** (empresas/CNPJ) → **clinics** (clínicas) → **units** (unidades)
- **users** → **roles** → **permissions** (RBAC granular por módulo/unidade)
- **patients** (pacientes), com índice único por `cpf + clinic_id` para evitar duplicidade
- **leads** → **lead_interactions**, **lead_status_history**
- **professionals** → **professional_specialties**, **professional_documents**
- **appointments** (agenda) → `room_id`, `equipment_id`, `professional_id`, `patient_id`
- **procedures** (catálogo de procedimentos) → **procedure_price_table**
- **budgets** (orçamentos) → **budget_items**, **budget_versions**
- **contracts** (financeiro) → **installments** (parcelas)
- **payment_methods**, **card_transactions** (taxas, bandeiras, antecipação)
- **accounts_receivable**, **accounts_payable**
- **bank_accounts**, **cash_ledger** (fluxo de caixa), **reconciliations**
- **cost_centers**, **financial_categories**
- **inventory_items**, **inventory_movements**, **suppliers**, **purchase_orders**
- *lab_orders* (laboratórios/próteses) — Fase 2
- *clinical_records*, *odontogram*, *treatment_plans* — Fase 2 (prontuário)
- *documents*, *contracts_templates*, *signatures* — Fase 2 (documental)
- **audit_log** (toda escrita relevante gera um registro: quem, quando, o quê, valor antes/depois)
- **notifications**, **automation_rules**, **automation_runs**

Regras de integridade centrais:
- Toda tabela financeira carrega `clinic_id` e `unit_id` (particionamento lógico e permissões).
- Nenhum registro financeiro é apagado fisicamente — apenas `status = cancelado/estornado` (exigência de auditoria).
- `installments` sempre referenciam `contracts` → `budgets` → `patients`, garantindo rastreabilidade completa do dinheiro até o paciente.

O schema SQL completo do MVP (com todas as tabelas acima em **negrito**, tipos, chaves estrangeiras e índices) está no arquivo `02-schema-mvp.sql`, pronto para rodar em PostgreSQL.

---

## 6. Perfis e permissões (RBAC)

Modelo: **usuário → um ou mais perfis → permissões por módulo × ação × unidade**.

Ações controladas por módulo: `view`, `create`, `edit`, `delete`, `approve`, `export`, `view_financial_values`.

Perfis sugeridos já no MVP: Proprietário, Gestor, Financeiro/BPO, Recepção/Comercial, Dentista, Auditor (somente leitura + logs). Os demais perfis do briefing (Instrumentador, Estoquista, Laboratório etc.) entram quando os respectivos módulos forem ativados (Fase 2).

Toda ação crítica (excluir, aprovar desconto acima do limite, cancelar parcela, mover dinheiro entre contas) exige confirmação explícita e é gravada no `audit_log` com usuário, IP e timestamp — isso vale também para ações sugeridas pelo agente de IA.

---

## 7. Regras de negócio principais (MVP)

- Um orçamento aprovado só pode virar contrato depois de gerar as parcelas de acordo com a forma de pagamento escolhida.
- Desconto acima do limite configurado por perfil exige aprovação de um usuário com permissão `approve` — o sistema registra quem autorizou.
- Um agendamento não pode ser confirmado se o paciente estiver inadimplente acima do limite configurado (parametrizável por clínica) — isso gera um alerta, não um bloqueio automático rígido, para não travar a recepção em exceções legítimas.
- Toda baixa de conta a receber/pagar é vinculada a uma conta bancária e reflete no fluxo de caixa no mesmo instante (sem lote noturno).
- Regime de caixa e regime de competência coexistem: a data de competência (quando a receita/despesa "pertence") é sempre registrada separadamente da data de pagamento/recebimento efetivo, para permitir o DRE gerencial correto.

---

## 8. Automações (MVP)

Motor de automação genérico: **gatilho + condição + ação**, com histórico de execução e liga/desliga por regra. No MVP, entram as automações internas (sem canal externo ainda, já que WhatsApp/e-mail são integrações futuras):

- Alertar recepção quando uma parcela vence em 3 dias.
- Alertar gestor quando o saldo projetado de caixa fica negativo em qualquer um dos horizontes (7/15/30 dias).
- Criar tarefa de follow-up automática quando um lead fica 48h sem interação.
- Alertar quando o estoque de um item cai abaixo do mínimo.
- Gerar resumo diário/semanal/mensal (texto, via agente de IA) para o gestor.

---

## 9. Indicadores (MVP)

Faturamento (bruto/líquido/recebido/pendente), ticket médio, taxa de conversão do funil, taxa de comparecimento/falta, inadimplência, saldo de caixa atual e projetado, produção por profissional, ocupação de agenda, DRE simplificado. Os indicadores de rentabilidade por procedimento e CAC/ROI entram na Fase 2, quando o módulo de custos por procedimento (fichas técnicas de estoque) estiver maduro.

---

## 10. Design do dashboard

Painel executivo dividido em 4 blocos, do mais urgente ao mais analítico:
1. **Ação imediata** — contas vencidas hoje, pacientes inadimplentes críticos, agenda com conflitos, estoque crítico.
2. **Financeiro do dia/mês** — saldo, faturamento, recebido, a receber, a pagar.
3. **Comercial** — leads novos, avaliações, fechamentos, taxa de conversão.
4. **Tendência** — gráfico de faturamento x meta, projeção de caixa (linha com cenário otimista/realista/conservador).

Filtros persistentes no topo (período, clínica/unidade, profissional), aplicados a todos os blocos.

---

## 11. Plano de desenvolvimento e fases

**Fase 1 — MVP (entregue a seguir, em código):**
Login/autenticação, empresas/clínicas/unidades, pacientes, leads básico, agenda, orçamentos e fechamentos, contas a pagar/receber, formas de pagamento, fluxo de caixa, estoque básico, dashboard, relatórios principais, agente de IA financeiro (leitura + Q&A + alertas), perfis/permissões, auditoria.

**Fase 2 — Módulos avançados:**
Prontuário eletrônico completo + odontograma (exige o maior cuidado de segurança/versionamento — ver documento 2), contratos e assinatura eletrônica (documento 3), laboratórios/próteses, comissões e diárias detalhadas, conciliação bancária automática (importação de extrato), campanhas de reativação.

**Fase 3 — Inteligência e expansão:**
Previsões por IA (inadimplência, projeção de caixa com machine learning), integrações reais (WhatsApp, Google Calendar, gateways de pagamento), aplicativo móvel nativo, assinatura eletrônica com certificado digital.

---

## 12. Critérios de teste

- **Financeiro:** toda operação de baixa/estorno testada com casos de borda (baixa parcial, baixa em duplicidade — deve ser bloqueada, estorno após conciliação).
- **Permissões:** teste automatizado por perfil garantindo que um usuário nunca vê dado fora de sua unidade/permissão (inclusive via API direta, não só na tela).
- **Auditoria:** toda ação crítica deve gerar exatamente um registro de log, verificável em teste.
- **Agente de IA:** conjunto de perguntas de referência (as listadas no briefing) com respostas validadas contra o banco — o agente é testado para *nunca* responder um número que não veio de uma consulta real.

---

## 13. Plano de segurança

- Autenticação com hash forte (bcrypt/argon2) + 2FA obrigatório para perfis financeiros/gestores.
- Row-level security no PostgreSQL por `clinic_id`/`unit_id`, além do RBAC de aplicação (defesa em profundidade).
- Criptografia em trânsito (TLS) e em repouso para campos sensíveis (CPF, dados bancários).
- Log de auditoria imutável (append-only) separado do banco operacional.
- Conformidade LGPD: consentimento registrado, direito de exportação/eliminação lógica dos dados do titular, minimização de dados no agente de IA (ele não recebe CPF/dados bancários brutos nas consultas, só os agregados necessários).

## 14. Estratégia de backup

Backup incremental diário + backup completo semanal, retenção mínima de 90 dias, testes de restauração trimestrais, réplica geograficamente separada. Documentos (contratos, exames, fotos) no object storage com versionamento nativo (nunca sobrescreve, sempre nova versão).

---

## 15. Exemplos de uso do agente financeiro (validados contra o modelo de dados do MVP)

> *"Quanto a clínica faturou neste mês?"* → soma de `budgets`/`contracts` fechados no mês, por unidade, com breakdown bruto vs. líquido.
> *"Tenho caixa suficiente para os próximos 30 dias?"* → projeção a partir de `accounts_receivable` + `accounts_payable` previstos, comparado ao saldo atual em `bank_accounts`.
> *"Quais pacientes estão inadimplentes?"* → `accounts_receivable` com status `vencido`, agrupado por paciente, com dias de atraso.
> *"Onde posso reduzir custos sem prejudicar a operação?"* → comparação de `accounts_payable` por categoria/centro de custo vs. média histórica, sinalizando outliers — sempre como sugestão, nunca como decisão automática.

Se o dado não existir no banco (ex: rentabilidade por procedimento antes da Fase 2), o agente deve dizer isso explicitamente, nunca estimar.

---

**Próximo passo:** o arquivo `02-schema-mvp.sql` (anexo) já traz a estrutura de banco do MVP pronta para uso. A partir dele, o próximo passo natural é construir a API do MVP (autenticação, CRUD de pacientes/agenda/financeiro) — um projeto de várias sessões de trabalho, dado o tamanho. Posso seguir por esse caminho módulo a módulo, começando por onde for mais útil pra você agora (ex: financeiro, já que você já tem a base em planilhas).
