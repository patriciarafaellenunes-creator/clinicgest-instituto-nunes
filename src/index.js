// src/index.js — entrypoint da API
//
// Caminho explícito: dotenv por padrão procura o .env em process.cwd(), que
// depende de onde o processo foi iniciado, não de onde este arquivo está.
// Isso já causou o .env ser ignorado silenciosamente quando o servidor sobe
// a partir de scripts/dev-server-fake-db.js com cwd na pasta pai do projeto.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const financialRoutes = require('./routes/financial');
const patientsRoutes = require('./routes/patients');
const agendaRoutes = require('./routes/agenda');
const leadsRoutes = require('./routes/leads');
const budgetsRoutes = require('./routes/budgets');
const inventoryRoutes = require('./routes/inventory');
const agentRoutes = require('./routes/agent');
const purchasingRoutes = require('./routes/purchasing');
const clinicalRecordsRoutes = require('./routes/clinicalRecords');
const odontogramRoutes = require('./routes/odontogram');
const periodontalRoutes = require('./routes/periodontal');
const treatmentPlansRoutes = require('./routes/treatmentPlans');
const clinicalDocumentsRoutes = require('./routes/clinicalDocuments');
const clinicalExamsRoutes = require('./routes/clinicalExams');
const patientFilesRoutes = require('./routes/patientFiles');
const documentsRoutes = require('./routes/documents');
const termsLibraryRoutes = require('./routes/termsLibrary');
const professionalContractsRoutes = require('./routes/professionalContracts');
const supplierContractsRoutes = require('./routes/supplierContracts');
const documentAutomationRoutes = require('./routes/documentAutomation');
const labOrdersRoutes = require('./routes/labOrders');
const commissionsRoutes = require('./routes/commissions');
const dailyShiftsRoutes = require('./routes/dailyShifts');
const professionalsRoutes = require('./routes/professionals');
const proceduresRoutes = require('./routes/procedures');
const unitsRoutes = require('./routes/units');
const suppliersRoutes = require('./routes/suppliers');
const bankAccountsRoutes = require('./routes/bankAccounts');
const eSignatureRoutes = require('./routes/eSignature');
const webhooksRoutes = require('./routes/webhooks');

const app = express();

// Frontend e backend vivem em domínios diferentes em produção (Vercel +
// Railway), então o navegador bloqueia a chamada sem CORS liberado
// explicitamente. FRONTEND_URL trava a liberação só no domínio real do
// site da clínica — nunca liberamos "*" aqui porque a API carrega dados
// de pacientes (LGPD). Sem FRONTEND_URL definida (dev local), libera tudo.
app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));

// IMPORTANTE: a rota de webhooks precisa vir ANTES do express.json() global.
// Ela usa express.raw() pra receber o corpo exato (bytes crus), necessário
// pra calcular o hash HMAC de validação — se o express.json() global rodasse
// primeiro, o corpo já teria sido consumido e convertido em objeto, e a
// validação de assinatura do webhook nunca bateria.
app.use('/api/webhooks', webhooksRoutes);

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/financial', financialRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/agenda', agendaRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/purchasing', purchasingRoutes);
app.use('/api/clinical', clinicalRecordsRoutes);
app.use('/api/odontogram', odontogramRoutes);
app.use('/api/periodontal', periodontalRoutes);
app.use('/api/treatment-plans', treatmentPlansRoutes);
app.use('/api/clinical-documents', clinicalDocumentsRoutes);
app.use('/api/clinical-exams', clinicalExamsRoutes);
app.use('/api/patient-files', patientFilesRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/terms-library', termsLibraryRoutes);
app.use('/api/professional-contracts', professionalContractsRoutes);
app.use('/api/supplier-contracts', supplierContractsRoutes);
app.use('/api/document-automation', documentAutomationRoutes);
app.use('/api/lab-orders', labOrdersRoutes);
app.use('/api/commissions', commissionsRoutes);
app.use('/api/daily-shifts', dailyShiftsRoutes);
app.use('/api/professionals', professionalsRoutes);
app.use('/api/procedures', proceduresRoutes);
app.use('/api/units', unitsRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/bank-accounts', bankAccountsRoutes);
app.use('/api', eSignatureRoutes);

// Handler de erro genérico (garante que nunca vaza stack trace pro cliente)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ClinicGest API rodando na porta ${PORT}`));
}

module.exports = app;
