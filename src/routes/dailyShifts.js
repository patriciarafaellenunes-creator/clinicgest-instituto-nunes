// src/routes/dailyShifts.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const dailyShiftsService = require('../services/dailyShiftsService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof dailyShiftsService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/', requirePermission('daily_shifts', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      dailyShiftsService.createDailyShift(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/approve', requirePermission('daily_shifts', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      dailyShiftsService.approveDailyShift(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/pay', requirePermission('daily_shifts', 'edit'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      dailyShiftsService.payDailyShifts(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/', requirePermission('daily_shifts', 'view'), async (req, res) => {
  try {
    const { professionalId, from, to, status } = req.query;
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      dailyShiftsService.listDailyShifts(client, req.auth.clinicId, { professionalId, from, to, status })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
