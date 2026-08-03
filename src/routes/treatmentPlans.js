// src/routes/treatmentPlans.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const treatmentPlanService = require('../services/treatmentPlanService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof treatmentPlanService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      treatmentPlanService.createTreatmentPlan(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => treatmentPlanService.getPatientTreatmentPlans(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:id', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => treatmentPlanService.getTreatmentPlanWithItems(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/status', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      treatmentPlanService.updatePlanStatus(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/items/:itemId/decision', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      treatmentPlanService.recordItemDecision(client, { itemId: req.params.itemId, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/convert-to-budget', requirePermission('budgets', 'create'), async (req, res) => {
  try {
    const budget = await withTenantClient(req.auth.clinicId, (client) =>
      treatmentPlanService.convertAcceptedItemsToBudget(client, { planId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.status(201).json(budget);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
