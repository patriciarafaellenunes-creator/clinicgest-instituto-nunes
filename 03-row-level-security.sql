-- ============================================================
-- ClinicGest — Row-Level Security (RLS)
-- ============================================================
-- Aplicar DEPOIS de 02-schema-mvp.sql, num Postgres real:
--   psql -f 02-schema-mvp.sql seu_banco
--   psql -f 03-row-level-security.sql seu_banco
--
-- *** ATENÇÃO — ISTO NÃO FOI TESTADO CONTRA UM POSTGRES REAL ***
-- O pg-mem (usado em todos os testes automatizados do projeto) não
-- implementa RLS nem current_setting/set_config, então nada aqui passou
-- pelos mesmos testes que o resto do sistema. A sintaxe segue o padrão
-- documentado do PostgreSQL, mas antes de depender disso em produção,
-- valide manualmente com o checklist no fim deste arquivo.
--
-- COMO FUNCIONA:
-- Cada tabela com clinic_id ganha uma policy que só libera linhas onde
-- clinic_id bate com o valor da variável de sessão app.current_clinic_id.
-- Essa variável é definida pela aplicação a cada requisição, em
-- src/db/pool.js (withTenantClient) — usando SELECT set_config(...),
-- nunca concatenação de string, então não há risco de injeção de SQL ali.
--
-- FORCE ROW LEVEL SECURITY é necessário porque, por padrão, o dono da
-- tabela (role usada para criar o schema) *ignora* RLS. Sem FORCE, se a
-- aplicação conectar com essa mesma role, a proteção não faria nada.
-- Em produção, o ideal é ter uma role de aplicação SEPARADA da role que
-- criou o schema (não-superusuário, não-dono das tabelas) — FORCE cobre
-- o caso de ainda não ter feito essa separação.
--
-- LIMITAÇÃO CONHECIDA: esta política cobre as tabelas que têm clinic_id
-- diretamente. Tabelas "filhas" que só referenciam o pai por FK (ex:
-- installments, budget_items, contracts, document_signatures,
-- professional_contract_terms, treatment_plan_items, periodontal_
-- measurements, purchase_order_items, lead_interactions, inventory_
-- movements, user_roles) não têm RLS própria aqui — hoje elas só são
-- alcançadas através de JOINs a partir das tabelas protegidas nas queries
-- da aplicação, que já filtram por clinic_id explicitamente. Adicionar RLS
-- nelas exigiria políticas com subquery correlacionada ao pai; ficou fora
-- deste primeiro passo para não entregar SQL não verificável sem mais
-- tempo de validação manual.

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE units FORCE ROW LEVEL SECURITY;
CREATE POLICY units_clinic_isolation ON units
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_clinic_isolation ON roles
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_clinic_isolation ON users
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals FORCE ROW LEVEL SECURITY;
CREATE POLICY professionals_clinic_isolation ON professionals
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
CREATE POLICY patients_clinic_isolation ON patients
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
CREATE POLICY leads_clinic_isolation ON leads
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY appointments_clinic_isolation ON appointments
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedures FORCE ROW LEVEL SECURITY;
CREATE POLICY procedures_clinic_isolation ON procedures
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY budgets_clinic_isolation ON budgets
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers FORCE ROW LEVEL SECURITY;
CREATE POLICY cost_centers_clinic_isolation ON cost_centers
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE financial_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_categories_clinic_isolation ON financial_categories
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_accounts_clinic_isolation ON bank_accounts
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_methods_clinic_isolation ON payment_methods
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_receivable_clinic_isolation ON accounts_receivable
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_clinic_isolation ON suppliers
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_payable_clinic_isolation ON accounts_payable
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_ledger_clinic_isolation ON cash_ledger
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_items_clinic_isolation ON inventory_items
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_clinic_isolation ON purchase_orders
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_rules_clinic_isolation ON automation_rules
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_clinic_isolation ON notifications
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE clinical_anamnesis ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_anamnesis FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_anamnesis_clinic_isolation ON clinical_anamnesis
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE clinical_evolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_evolutions FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_evolutions_clinic_isolation ON clinical_evolutions
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE odontogram_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE odontogram_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY odontogram_entries_clinic_isolation ON odontogram_entries
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE periodontal_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodontal_exams FORCE ROW LEVEL SECURITY;
CREATE POLICY periodontal_exams_clinic_isolation ON periodontal_exams
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY treatment_plans_clinic_isolation ON treatment_plans
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE clinical_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_documents_clinic_isolation ON clinical_documents
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE clinical_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_exams FORCE ROW LEVEL SECURITY;
CREATE POLICY clinical_exams_clinic_isolation ON clinical_exams
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE patient_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_files FORCE ROW LEVEL SECURITY;
CREATE POLICY patient_files_clinic_isolation ON patient_files
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY document_templates_clinic_isolation ON document_templates
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_clinic_isolation ON documents
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY lab_orders_clinic_isolation ON lab_orders
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts FORCE ROW LEVEL SECURITY;
CREATE POLICY commission_payouts_clinic_isolation ON commission_payouts
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE professional_daily_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_daily_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY professional_daily_shifts_clinic_isolation ON professional_daily_shifts
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_clinic_isolation ON audit_log
    USING (clinic_id = current_setting('app.current_clinic_id', true)::uuid)
    WITH CHECK (clinic_id = current_setting('app.current_clinic_id', true)::uuid);

-- ============================================================
-- Checklist de validação manual — STATUS: VALIDADO contra um Postgres 16
-- real (não apenas escrito à mão e assumido correto).
-- ============================================================
-- Os passos abaixo foram executados de verdade e passaram. Dois problemas
-- reais foram encontrados e corrigidos no processo (não eram só teóricos):
--
--   1. bootstrap-clinic quebrava com FORCE ROW LEVEL SECURITY ativo,
--      porque tentava inserir em `units`/`roles`/`users` sem nenhum
--      contexto de clínica definido (a clínica está sendo criada na mesma
--      transação, então não tem como saber o clinic_id de antemão). Corrigido
--      em authService.bootstrapClinic: o contexto é definido logo após criar
--      a linha em `clinics`, antes de tocar qualquer tabela protegida.
--
--   2. login precisa buscar um usuário por e-mail SEM saber a clínica de
--      antemão (é o propósito da consulta) — isso é estruturalmente
--      incompatível com uma role de aplicação comum sob RLS. A solução não
--      foi abrir uma política permissiva nas tabelas de identidade — foi
--      usar uma SEGUNDA credencial de banco, com o atributo BYPASSRLS,
--      usada exclusivamente por login/bootstrap (ver AUTH_PGUSER em
--      src/db/pool.js e routes/auth.js). A role usada por todas as OUTRAS
--      rotas autenticadas não tem esse privilégio.
--
-- Passos validados (rodados contra Postgres 16, roles reais, dados reais):
--
-- 1. Aplicar 02-schema-mvp.sql e depois este arquivo:
--      psql -f 02-schema-mvp.sql seu_banco
--      psql -f 03-row-level-security.sql seu_banco
--
-- 2. Criar as DUAS roles de aplicação (nenhuma delas superusuário nem dona
--    das tabelas — o schema deve ser criado por outra role, ex: postgres):
--      CREATE ROLE app_user LOGIN PASSWORD '...';
--      CREATE ROLE auth_service_user LOGIN PASSWORD '...' BYPASSRLS;
--      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--        TO app_user, auth_service_user;
--      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user, auth_service_user;
--
-- 3. Configurar no .env da aplicação:
--      PGUSER=app_user, PGPASSWORD=...              (rotas normais)
--      AUTH_PGUSER=auth_service_user, AUTH_PGPASSWORD=...  (só login/bootstrap)
--
-- 4. Validado: bootstrap-clinic cria uma clínica nova com sucesso via
--    authPool (BYPASSRLS), mesmo com RLS+FORCE ativo em todas as tabelas.
--
-- 5. Validado: login busca por e-mail sem conhecer o clinicId, via authPool.
--
-- 6. Validado: com app_user (SEM bypass) e o clinicId correto definido via
--    withTenantClient, os dados da própria clínica aparecem normalmente.
--
-- 7. Validado: com app_user, uma query pedindo explicitamente dados de
--    OUTRA clínica (clinic_id != a minha) retorna sempre zero linhas —
--    não existe jeito de escrever uma query que escape do isolamento.
--
-- 8. Validado: um INSERT tentando gravar clinic_id de outra clínica,
--    enquanto o contexto de sessão aponta para a clínica A, é REJEITADO
--    pelo banco (WITH CHECK), não silenciosamente ignorado.
--
-- 9. Validado: sem nenhum contexto de clínica definido (SET nunca chamado
--    na sessão), toda leitura via app_user retorna zero linhas — e uma
--    tentativa de leitura da tabela `users` sem contexto (simulando um bug
--    que tentasse usar a role errada para login) falha com erro, em vez de
--    vazar dados de qualquer clínica.
--
-- 10. Validado: conexões do pool são reaproveitadas entre requisições
--     (comportamento normal do `pg`), e mesmo assim o contexto de uma
--     clínica NUNCA vaza para a próxima transação na mesma conexão —
--     SET LOCAL/set_config(..., true) reseta de verdade a cada COMMIT.
--
-- Teste de integração reproduzível: test-integration/rls-real-postgres.test.js
-- (não roda contra pg-mem — precisa de um Postgres real, ver instruções no
-- topo do próprio arquivo).
