// src/routes/budgets.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const budgetsService = require('../services/budgetsService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof budgetsService.DomainError) {
    const status = err.code === 'DISCOUNT_APPROVAL_REQUIRED' ? 403 : 422;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/', requirePermission('budgets', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      budgetsService.listBudgets(client, req.auth.clinicId, { status: req.query.status })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('budgets', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      budgetsService.createBudget(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:id', requirePermission('budgets', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => budgetsService.getBudgetWithItems(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/status', requirePermission('budgets', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      budgetsService.updateBudgetStatus(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/approve', requirePermission('budgets', 'approve'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      budgetsService.approveBudget(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
