-- ============================================================
-- ClinicGest — Schema MVP (PostgreSQL 14+)
-- Fase 1: núcleo operacional + financeiro + estoque + auditoria
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- 1. IDENTIDADE / MULTI-TENANCY
-- ============================================================

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name TEXT NOT NULL,
    trade_name TEXT,
    cnpj TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id), -- NULL = perfil padrão do sistema
    name TEXT NOT NULL,                    -- Proprietário, Gestor, Financeiro, Recepção, Dentista, Auditor...
    description TEXT
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    module TEXT NOT NULL,                  -- 'patients','financial','agenda','inventory', etc.
    action TEXT NOT NULL,                  -- 'view','create','edit','delete','approve','export','view_financial_values'
    UNIQUE (role_id, module, action)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, email)
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id),     -- NULL = todas as unidades da clínica
    UNIQUE (user_id, role_id, unit_id)
);

-- ============================================================
-- 2. PROFISSIONAIS
-- ============================================================

CREATE TABLE professionals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    user_id UUID REFERENCES users(id),
    full_name TEXT NOT NULL,
    professional_role TEXT NOT NULL,       -- dentista, instrumentador, auxiliar, recepção...
    council_registration TEXT,             -- CRO etc.
    registration_expiry DATE,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE professional_units (
    professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    PRIMARY KEY (professional_id, unit_id)
);

-- ============================================================
-- 3. PACIENTES
-- ============================================================

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    full_name TEXT NOT NULL,
    cpf TEXT,
    birth_date DATE,
    phone TEXT,
    whatsapp TEXT,
    email TEXT,
    address TEXT,
    financial_guardian TEXT,               -- responsável financeiro
    source TEXT,                           -- origem do paciente
    responsible_professional_id UUID REFERENCES professionals(id),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, cpf)
);
CREATE INDEX idx_patients_phone ON patients (clinic_id, phone);
CREATE INDEX idx_patients_email ON patients (clinic_id, email);

-- ============================================================
-- 4. CRM / LEADS
-- ============================================================

CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    patient_id UUID REFERENCES patients(id), -- preenchido quando o lead vira paciente
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    procedure_interest TEXT,
    source TEXT,
    campaign TEXT,
    assigned_user_id UUID REFERENCES users(id),
    professional_id UUID REFERENCES professionals(id),
    potential_value NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'novo_lead',
        -- novo_lead, primeiro_contato, em_atendimento, avaliacao_agendada, avaliacao_confirmada,
        -- avaliacao_realizada, orcamento_apresentado, em_negociacao, aguardando_decisao,
        -- fechado, perdido, em_tratamento, pos_tratamento, reativacao
    loss_reason TEXT,
    next_action TEXT,
    next_action_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lead_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    interaction_type TEXT NOT NULL,        -- ligação, whatsapp, e-mail, presencial
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. AGENDA
-- ============================================================

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id),
    name TEXT NOT NULL
);

CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID NOT NULL REFERENCES units(id),
    patient_id UUID REFERENCES patients(id),
    lead_id UUID REFERENCES leads(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    room_id UUID REFERENCES rooms(id),
    procedure_id UUID,                     -- FK adicionada após a tabela procedures
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'agendado',
        -- agendado, confirmado, em_espera, em_atendimento, finalizado, reagendado, cancelado, faltou
    cancel_reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appointments_professional_time ON appointments (professional_id, starts_at);
CREATE INDEX idx_appointments_room_time ON appointments (room_id, starts_at);

-- ============================================================
-- 6. PROCEDIMENTOS / ORÇAMENTOS
-- ============================================================

CREATE TABLE procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,
    default_price NUMERIC(12,2),
    avg_duration_minutes INT,
    specialty TEXT
);
ALTER TABLE appointments ADD CONSTRAINT fk_appt_procedure FOREIGN KEY (procedure_id) REFERENCES procedures(id);

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID NOT NULL REFERENCES units(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID REFERENCES professionals(id),
    status TEXT NOT NULL DEFAULT 'rascunho',
        -- rascunho, apresentado, em_negociacao, aprovado, parcialmente_aprovado, recusado, expirado, cancelado
    version INT NOT NULL DEFAULT 1,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_approved_by UUID REFERENCES users(id),
    valid_until DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budget_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    procedure_id UUID NOT NULL REFERENCES procedures(id),
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL,
    discount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL
);

-- Um orçamento aprovado gera um "contrato" financeiro simplificado no MVP
CREATE TABLE contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES budgets(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    total_amount NUMERIC(12,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativo',  -- ativo, quitado, cancelado, renegociado
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. FINANCEIRO
-- ============================================================

CREATE TABLE cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL
);

CREATE TABLE financial_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('receita','despesa'))
);

CREATE TABLE bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,
    bank_name TEXT,
    current_balance NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,                    -- dinheiro, pix, débito, crédito, boleto...
    is_card BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    installment_number INT NOT NULL,
    due_date DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    payment_method_id UUID REFERENCES payment_methods(id),
    status TEXT NOT NULL DEFAULT 'previsto',
        -- previsto, pendente, parcialmente_pago, pago, vencido, renegociado, cancelado, estornado
    paid_at DATE,
    paid_amount NUMERIC(12,2)
);

CREATE TABLE accounts_receivable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    patient_id UUID REFERENCES patients(id),
    installment_id UUID REFERENCES installments(id),
    bank_account_id UUID REFERENCES bank_accounts(id),
    category_id UUID REFERENCES financial_categories(id),
    cost_center_id UUID REFERENCES cost_centers(id),
    competence_date DATE NOT NULL,         -- regime de competência
    due_date DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    received_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pendente',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    legal_name TEXT NOT NULL,
    trade_name TEXT,
    cnpj_cpf TEXT,
    contact_phone TEXT,
    contact_email TEXT
);

CREATE TABLE accounts_payable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    supplier_id UUID REFERENCES suppliers(id),
    bank_account_id UUID REFERENCES bank_accounts(id),
    category_id UUID REFERENCES financial_categories(id),
    cost_center_id UUID REFERENCES cost_centers(id),
    description TEXT NOT NULL,
    competence_date DATE NOT NULL,
    due_date DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pendente',
        -- pendente, aprovado, pago, vencido, cancelado
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installment_id UUID REFERENCES installments(id),
    operator TEXT,                         -- Stone, Cielo, PagSeguro...
    card_brand TEXT,
    installment_count INT,
    gross_amount NUMERIC(12,2) NOT NULL,
    fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_amount NUMERIC(12,2) NOT NULL,
    expected_receipt_date DATE,
    actual_receipt_date DATE,
    transaction_code TEXT,
    reconciliation_status TEXT NOT NULL DEFAULT 'pendente'
);

CREATE TABLE cash_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
    entry_date DATE NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('entrada','saida','transferencia')),
    amount NUMERIC(12,2) NOT NULL,
    source_table TEXT,                     -- 'accounts_receivable' | 'accounts_payable' | 'manual'
    source_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. ESTOQUE / COMPRAS
-- ============================================================

CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    name TEXT NOT NULL,
    category TEXT,
    unit_of_measure TEXT,
    current_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    min_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    avg_cost NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES inventory_items(id),
    movement_type TEXT NOT NULL,           -- entrada, saida, transferencia, ajuste, perda
    quantity NUMERIC(12,3) NOT NULL,
    related_appointment_id UUID REFERENCES appointments(id),
    responsible_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'solicitado',
    total_amount NUMERIC(12,2),
    accounts_payable_id UUID REFERENCES accounts_payable(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ficha técnica: consumo esperado de cada material por procedimento (seção 13 do briefing)
CREATE TABLE procedure_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure_id UUID NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES inventory_items(id),
    quantity_per_procedure NUMERIC(12,3) NOT NULL,
    UNIQUE (procedure_id, item_id)
);

-- Itens de um pedido de compra (seção 14 do briefing)
CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES inventory_items(id),
    quantity NUMERIC(12,3) NOT NULL,
    unit_cost NUMERIC(12,2) NOT NULL
);

-- ============================================================
-- 9. AUDITORIA E NOTIFICAÇÕES
-- ============================================================

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    clinic_id UUID,
    user_id UUID,
    table_name TEXT NOT NULL,
    record_id UUID,
    action TEXT NOT NULL,                  -- insert, update, delete, approve, export
    before_value JSONB,
    after_value JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_record ON audit_log (table_name, record_id);

CREATE TABLE automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    condition JSONB,
    action_type TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES automation_rules(id),
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    result TEXT
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    user_id UUID REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 11. PRONTUÁRIO ELETRÔNICO (Fase 2 — documento 2 do briefing)
-- ============================================================
-- Regra de segurança clínica/jurídica central: nada aqui é sobrescrito.
-- "Editar" um registro clínico sempre cria uma NOVA linha; a linha antiga
-- fica marcada is_current = false, mas permanece intacta para auditoria.
-- Isso é imposto pela aplicação (clinicalRecordsService), não só por
-- convenção — ver a seção "Segurança clínica e jurídica" do documento 2.

CREATE TABLE clinical_anamnesis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    version INT NOT NULL DEFAULT 1,
    previous_version_id UUID REFERENCES clinical_anamnesis(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    chief_complaint TEXT,
    medical_history JSONB,
        -- estrutura livre: alergias, medicamentos em uso, doenças preexistentes,
        -- cirurgias anteriores, hábitos, gestação, uso de anticoagulantes,
        -- pressão arterial etc. (seção "Prontuário eletrônico" do documento 2)
    risk_classification TEXT,
    clinical_alerts TEXT[],
    signed_by_patient BOOLEAN NOT NULL DEFAULT false,
    signed_by_professional_id UUID REFERENCES professionals(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anamnesis_patient_current ON clinical_anamnesis (patient_id, is_current);

CREATE TABLE clinical_evolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    appointment_id UUID REFERENCES appointments(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    procedure_id UUID REFERENCES procedures(id),
    tooth_or_region TEXT,
    description TEXT NOT NULL,
    materials_used TEXT,
    medications_administered TEXT,
    anesthetic_used TEXT,
    complications TEXT,
    patient_instructions TEXT,
    next_step TEXT,
    return_recommended_days INT,
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES clinical_evolutions(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_evolutions_patient_current ON clinical_evolutions (patient_id, is_current);

-- Odontograma: um "slot" é a combinação (dente, face). Cada slot tem uma
-- cadeia de versões igual à de clinical_evolutions — corrigir uma condição
-- não apaga a anterior, cria uma nova versão apontando pra ela. Face NULL
-- representa uma condição do dente inteiro (ex: ausente, implante).
CREATE TABLE odontogram_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    tooth_number TEXT NOT NULL,
    face TEXT,
    tooth_condition TEXT NOT NULL,
        -- ausente, carie, restauracao, coroa, implante, protese, fratura,
        -- tratamento_endodontico, mobilidade, lesao, procedimento_indicado
    status TEXT NOT NULL DEFAULT 'realizado', -- indicado | realizado
    notes TEXT,
    professional_id UUID REFERENCES professionals(id),
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES odontogram_entries(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_odontogram_patient_current ON odontogram_entries (patient_id, is_current);
CREATE INDEX idx_odontogram_slot ON odontogram_entries (patient_id, tooth_number, face);

-- Periodontograma: cada exame é uma "foto" completa de uma visita, com
-- múltiplas medições (uma por dente/face de sondagem). Corrigir um exame
-- inteiro (ex: erro de digitação) segue o mesmo padrão de versão em cadeia
-- do odontograma — nunca edita o exame já registrado, cria um novo
-- apontando para o anterior.
CREATE TABLE periodontal_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    appointment_id UUID REFERENCES appointments(id),
    exam_date DATE NOT NULL,
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES periodontal_exams(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_periodontal_exams_patient ON periodontal_exams (patient_id, is_current, exam_date);

CREATE TABLE periodontal_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES periodontal_exams(id) ON DELETE CASCADE,
    tooth_number TEXT NOT NULL,
    site TEXT NOT NULL,
        -- mesio_vestibular, vestibular, disto_vestibular, mesio_lingual, lingual, disto_lingual
    probing_depth INT,      -- profundidade de sondagem (mm)
    bleeding BOOLEAN NOT NULL DEFAULT false,
    recession INT,          -- recessão gengival (mm)
    mobility INT,           -- grau de mobilidade (0-3)
    furcation INT,          -- grau de furca (0-3)
    plaque BOOLEAN NOT NULL DEFAULT false,
    suppuration BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_periodontal_measurements_exam ON periodontal_measurements (exam_id);

-- Plano de tratamento clínico: sequência/prioridade clínica de procedimentos
-- por dente/região, com aceite ou recusa do paciente item a item. Diferente
-- do orçamento (que é sobre dinheiro): aqui a pergunta é "o que tratar e em
-- que ordem", não "quanto custa e como parcelar". A ponte entre os dois é
-- treatmentPlanService.convertAcceptedItemsToBudget, que pega só os itens
-- aceitos e monta um orçamento de verdade usando budgetsService — sem
-- duplicar a lógica de orçamento que já existe na Fase 1.
CREATE TABLE treatment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    status TEXT NOT NULL DEFAULT 'rascunho',
        -- rascunho, apresentado, aprovado, parcialmente_aprovado, recusado, cancelado, concluido
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES treatment_plans(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_treatment_plans_patient ON treatment_plans (patient_id, is_current);

CREATE TABLE treatment_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    treatment_plan_id UUID NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
    procedure_id UUID NOT NULL REFERENCES procedures(id),
    tooth_or_region TEXT,
    phase INT NOT NULL DEFAULT 1,
    priority TEXT NOT NULL DEFAULT 'media', -- alta, media, baixa
    sequence_order INT,
    estimated_duration_minutes INT,
    lab_required BOOLEAN NOT NULL DEFAULT false,
    clinical_cost NUMERIC(12,2),
    charged_value NUMERIC(12,2) NOT NULL,
    is_alternative_of UUID REFERENCES treatment_plan_items(id),
    patient_decision TEXT NOT NULL DEFAULT 'pendente', -- pendente, aceito, recusado
    decision_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_treatment_plan_items_plan ON treatment_plan_items (treatment_plan_id);

ALTER TABLE budgets ADD COLUMN treatment_plan_id UUID REFERENCES treatment_plans(id);

-- Prescrições, atestados e documentos clínicos. Regra de segurança: uma vez
-- emitido, um documento clínico NUNCA é editado — só cancelado (com motivo)
-- e, se necessário, reemitido como um documento novo. É o mesmo espírito de
-- "sem alteração silenciosa" dos outros módulos do prontuário, só que aqui
-- não existe cadeia de versões porque não faz sentido "corrigir" uma receita
-- já entregue ao paciente — corrige-se emitindo outra.
CREATE TABLE clinical_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    appointment_id UUID REFERENCES appointments(id),
    document_type TEXT NOT NULL,
        -- receita_simples, receita_controle_especial, atestado,
        -- declaracao_comparecimento, solicitacao_exame, encaminhamento, relatorio_clinico
    content JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'emitido', -- emitido, cancelado
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    cancelled_reason TEXT,
    cancelled_by UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clinical_documents_patient ON clinical_documents (patient_id, document_type);

-- Exames e diagnóstico: mesmo padrão de imutabilidade dos outros módulos
-- clínicos. "Corrigir" um achado ou diagnóstico não edita o registro, cria
-- um novo encadeado. Pode ser vinculado a um item do plano de tratamento
-- (o que fecha o ciclo: achado -> hipótese diagnóstica -> item do plano).
CREATE TABLE clinical_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    exam_type TEXT NOT NULL,
        -- clinico_intraoral, clinico_extraoral, oclusal, estetico, facial,
        -- radiografia, tomografia, laboratorial, fotografia
    tooth_or_region TEXT,
    treatment_plan_item_id UUID REFERENCES treatment_plan_items(id),
    findings TEXT,
    diagnostic_hypothesis TEXT,
    definitive_diagnosis TEXT,
    file_reference TEXT,
        -- caminho/URL do arquivo real (armazenamento em object storage — Fase 3);
        -- aqui só guardamos a referência e os dados clínicos estruturados
    exam_date DATE NOT NULL,
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES clinical_exams(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clinical_exams_patient ON clinical_exams (patient_id, is_current);

-- Arquivos do paciente: metadados apenas — o arquivo em si vive em object
-- storage (arquitetura definida no plano mestre), fora do escopo deste MVP.
-- Nunca há exclusão física: só exclusão lógica, com motivo, seção 9 do
-- documento 3 ("bloqueio contra exclusão definitiva").
CREATE TABLE patient_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID REFERENCES professionals(id),
    category TEXT NOT NULL,
        -- fotografia_clinica, fotografia_facial, fotografia_intraoral, radiografia,
        -- tomografia, escaneamento, video, audio, laudo, exame_laboratorial, documento
    related_procedure_id UUID REFERENCES procedures(id),
    related_exam_id UUID REFERENCES clinical_exams(id),
    file_reference TEXT NOT NULL,
    description TEXT,
    image_usage_authorized BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_reason TEXT,
    deleted_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_patient_files_patient ON patient_files (patient_id, is_deleted);

-- ============================================================
-- 12. CENTRAL DE DOCUMENTOS, CONTRATOS E ASSINATURA ELETRÔNICA
-- (Fase 2 — documento 3 do briefing)
-- ============================================================
-- Modelo genérico: um "documento" pode ser de paciente, profissional,
-- laboratório ou fornecedor — em vez de 4 tabelas separadas, um único
-- modelo com party_type + as FKs relevantes. Isso evita duplicar toda a
-- máquina de status/versionamento/assinatura 4 vezes.

CREATE TABLE document_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
        -- contrato_paciente, termo_paciente, contrato_profissional,
        -- contrato_laboratorio, contrato_fornecedor
    body_template TEXT NOT NULL,
    required_for_procedure_id UUID REFERENCES procedures(id),
        -- se preenchido, este documento é obrigatório antes desse procedimento específico
    required_for_specialty TEXT,
        -- alternativa mais ampla: obrigatório para qualquer procedimento dessa
        -- especialidade (ex: "implantodontia"), sem precisar listar cada procedimento
    clinical_content JSONB,
        -- riscos, benefícios, alternativas, cuidados antes/depois, contraindicações
        -- (seção 3 do documento 3 — "cada termo deve permitir" esses campos)
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    template_id UUID REFERENCES document_templates(id),
    document_number TEXT,
    category TEXT NOT NULL,
    party_type TEXT NOT NULL, -- patient, professional, supplier, lab
    patient_id UUID REFERENCES patients(id),
    professional_id UUID REFERENCES professionals(id),
    supplier_id UUID REFERENCES suppliers(id),
    related_procedure_id UUID REFERENCES procedures(id),
    related_treatment_plan_id UUID REFERENCES treatment_plans(id),
    related_budget_id UUID REFERENCES budgets(id),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'rascunho',
        -- rascunho, em_revisao, aguardando_aprovacao, aguardando_assinatura,
        -- parcialmente_assinado, assinado, vigente, proximo_vencimento, vencido,
        -- renovado, substituido, cancelado, arquivado
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES documents(id),
    is_current BOOLEAN NOT NULL DEFAULT true,
    valid_from DATE,
    valid_until DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_patient ON documents (patient_id, is_current);
CREATE INDEX idx_documents_professional ON documents (professional_id, is_current);
CREATE INDEX idx_documents_supplier ON documents (supplier_id, is_current);
CREATE INDEX idx_documents_validity ON documents (valid_until, status);

-- Adicionado ao integrar assinatura eletrônica real (Clicksign) — guarda o
-- id do envelope na Clicksign, pra reconhecer de qual documento local o
-- webhook de assinatura está falando quando ele chega.
ALTER TABLE documents ADD COLUMN external_signature_id TEXT;

CREATE TABLE document_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_name TEXT NOT NULL,
    signer_role TEXT NOT NULL,
        -- paciente, responsavel_legal, responsavel_financeiro, profissional,
        -- testemunha, fornecedor, laboratorio, gestor
    signer_document TEXT,
    signer_email TEXT,
    signature_method TEXT, -- desenhada, codigo_sms, codigo_email, link_seguro, certificado_digital
    signed_at TIMESTAMPTZ,
    ip_address TEXT,
    device_info TEXT,
    validation_code TEXT,
    status TEXT NOT NULL DEFAULT 'pendente', -- pendente, assinado, recusado
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_signatures_document ON document_signatures (document_id);

-- Termos estruturados do contrato de profissional (seção 4 do documento 3).
-- Fica separado do texto livre em documents.content porque estes campos
-- precisam ser CONSULTÁVEIS pelo sistema (ex: "este profissional pode fazer
-- este procedimento?"), não só lidos por humanos.
CREATE TABLE professional_contract_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    professional_id UUID NOT NULL REFERENCES professionals(id),
    authorized_specialties TEXT[],
    authorized_procedure_ids TEXT[],
    authorized_unit_ids TEXT[],
    remuneration_type TEXT, -- diaria, comissao_producao, comissao_recebimento, comissao_procedimento, fixo
    daily_rate NUMERIC(12,2),
    commission_percentage NUMERIC(5,2),
    lab_cost_discount_percentage NUMERIC(5,2),
    material_cost_discount_percentage NUMERIC(5,2),
    payment_term_days INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_professional_contract_terms_professional ON professional_contract_terms (professional_id);

-- Termos estruturados de contratos de fornecedor E laboratório (seções 5-6
-- do documento 3). Laboratórios reaproveitam a tabela `suppliers` já
-- existente (mesmo formato de dados: razão social, CNPJ, contatos) —
-- a diferença entre "fornecedor" e "laboratório" é só o category/party_type
-- do documento, não uma entidade separada no banco.
CREATE TABLE supplier_contract_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    contract_subtype TEXT,
        -- fornecimento, compra_recorrente, comodato, locacao_equipamento,
        -- manutencao, suporte, prestacao_servicos_laboratoriais, fornecimento_proteses
    products_or_services TEXT[],
    price_table JSONB,
    delivery_term_days INT,
    warranty_days INT,
    rework_policy TEXT,
    payment_terms TEXT,
    penalties TEXT,
    quality_criteria TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_contract_terms_supplier ON supplier_contract_terms (supplier_id);

-- ============================================================
-- 13. LABORATÓRIOS E PRÓTESES (módulo operacional — Fase 2)
-- ============================================================
-- Rastreamento de trabalhos enviados a laboratórios. Reaproveita `suppliers`
-- para identificar o laboratório (mesma decisão de design do módulo de
-- contratos: laboratório é uma entidade de fornecedor, o que muda é o
-- contexto de uso). O custo do trabalho se conecta ao financeiro via
-- accounts_payable quando o trabalho é finalizado.
CREATE TABLE lab_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    work_type TEXT NOT NULL,
    tooth_or_region TEXT,
    color TEXT,
    material TEXT,
    cost NUMERIC(12,2),
    sent_at DATE,
    expected_delivery_date DATE,
    received_at DATE,
    status TEXT NOT NULL DEFAULT 'solicitacao_criada',
        -- solicitacao_criada, moldagem_pendente, enviado, em_producao,
        -- prova_agendada, ajuste_solicitado, reenviado, recebido, instalado,
        -- finalizado, cancelado
    notes TEXT,
    related_treatment_plan_item_id UUID REFERENCES treatment_plan_items(id),
    accounts_payable_id UUID REFERENCES accounts_payable(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_orders_patient ON lab_orders (patient_id);
CREATE INDEX idx_lab_orders_status_delivery ON lab_orders (status, expected_delivery_date);

-- ============================================================
-- 14. COMISSÕES (cálculo periódico — Fase 2)
-- ============================================================
-- A garantia contra pagamento duplicado (exigência explícita do briefing,
-- seção 16) não é só lógica de aplicação: a constraint UNIQUE em
-- commission_payout_items.accounts_receivable_id impede, no nível do
-- banco, que a mesma conta a receber entre em duas apurações de comissão.
CREATE TABLE commission_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    commission_percentage NUMERIC(5,2) NOT NULL,
    total_base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'calculado', -- calculado, aprovado, pago, cancelado
    accounts_payable_id UUID REFERENCES accounts_payable(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_payouts_professional ON commission_payouts (professional_id, period_start);

CREATE TABLE commission_payout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commission_payout_id UUID NOT NULL REFERENCES commission_payouts(id) ON DELETE CASCADE,
    accounts_receivable_id UUID NOT NULL UNIQUE REFERENCES accounts_receivable(id),
    base_amount NUMERIC(12,2) NOT NULL,
    commission_amount NUMERIC(12,2) NOT NULL
);

-- ============================================================
-- 15. DIÁRIAS (Fase 1 do briefing original — nunca tinha sido construído)
-- ============================================================
-- Diferente de comissão (% sobre o que o paciente pagou), diária é um valor
-- fixo por dia de atendimento — típico de profissionais convidados/
-- plantonistas remunerados por presença, não por produção. Pagar um lote de
-- diárias gera uma conta a pagar real (mesma filosofia de lab_orders):
-- cada diária só entra em UMA conta a paga, nunca duas.
CREATE TABLE professional_daily_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id),
    unit_id UUID REFERENCES units(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    specialty TEXT,
    shift_date DATE NOT NULL,
    service_type TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente', -- pendente, aprovado, pago, cancelado
    accounts_payable_id UUID REFERENCES accounts_payable(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_daily_shifts_professional ON professional_daily_shifts (professional_id, shift_date);
CREATE INDEX idx_daily_shifts_status ON professional_daily_shifts (clinic_id, status);

-- Duas colunas que faltavam para migrar a planilha de produção sem perder
-- informação: "Descrição" de contas a receber (existia em contas a pagar,
-- mas não em contas a receber) e a classificação fixo/variável usada na DRE
-- gerencial da planilha (não existe nenhum campo equivalente hoje).
ALTER TABLE accounts_receivable ADD COLUMN description TEXT;
ALTER TABLE accounts_payable ADD COLUMN cost_nature TEXT CHECK (cost_nature IS NULL OR cost_nature IN ('fixo','variavel'));

-- ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY patients_clinic_isolation ON patients
--   USING (clinic_id = current_setting('app.current_clinic_id')::uuid);
-- (Repetir para cada tabela multi-tenant. A aplicação define app.current_clinic_id
--  por conexão/sessão, logo após autenticar o usuário.)
