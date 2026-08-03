// src/routes/commissions.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const commissionService = require('../services/commissionService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof commissionService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/', requirePermission('financial', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => commissionService.listCommissionPayouts(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/professionals/:professionalId/calculate', requirePermission('financial', 'create'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      commissionService.calculateCommissionForProfessional(client, {
        professionalId: req.params.professionalId, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body,
      })
    );
    res.status(201).json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:id', requirePermission('financial', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => commissionService.getCommissionPayoutWithItems(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/approve', requirePermission('financial', 'approve'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      commissionService.approveCommissionPayout(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/pay', requirePermission('financial', 'edit'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      commissionService.markCommissionPayoutAsPaid(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
