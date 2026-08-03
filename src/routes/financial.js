// src/routes/financial.js
// Endpoints do módulo financeiro. Regra geral: toda escrita roda dentro de uma
// transação (withTenantClient) e passa pelo financialService — a rota nunca escreve
// SQL diretamente, para as regras de negócio ficarem num único lugar testável.

const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const financialService = require('../services/financialService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof financialService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

// ---- Contas a pagar ----

router.get('/accounts-payable', requirePermission('financial', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.listAccountsPayable(client, req.auth.clinicId, { status: req.query.status })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/accounts-payable', requirePermission('financial', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.createAccountPayable(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/accounts-payable/:id/approve', requirePermission('financial', 'approve'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.approveAccountPayable(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/accounts-payable/:id/pay', requirePermission('financial', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.payAccountPayable(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

// ---- Contas a receber ----

router.get('/accounts-receivable', requirePermission('financial', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.listAccountsReceivable(client, req.auth.clinicId, { status: req.query.status })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/accounts-receivable', requirePermission('financial', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.createAccountReceivable(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/accounts-receivable/:id/receive', requirePermission('financial', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.receivePayment(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/accounts-receivable/overdue', requirePermission('financial', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.getOverdueReceivables(client, req.auth.clinicId)
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

// ---- Caixa / dashboard (também usados pelo agente de IA) ----

router.get('/cash/projection', requirePermission('financial', 'view'), async (req, res) => {
  try {
    const horizon = parseInt(req.query.days || '30', 10);
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.getCashProjection(client, req.auth.clinicId, horizon)
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/dashboard', requirePermission('financial', 'view_financial_values'), async (req, res) => {
  try {
    const periodStart = req.query.start || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const periodEnd = req.query.end || new Date().toISOString().slice(0, 10);
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      financialService.getDashboardSummary(client, req.auth.clinicId, { periodStart, periodEnd })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
