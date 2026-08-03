// src/routes/odontogram.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const odontogramService = require('../services/odontogramService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof odontogramService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/patients/:patientId/teeth', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      odontogramService.setToothCondition(client, {
        ...req.body, patientId: req.params.patientId, clinicId: req.auth.clinicId, userId: req.auth.userId,
      })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => odontogramService.getCurrentOdontogram(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/as-of', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => odontogramService.getOdontogramAsOf(client, req.auth.clinicId, req.params.patientId, req.query.date));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/compare', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const changes = await withTenantClient(req.auth.clinicId, (client) =>
      odontogramService.compareOdontogramSnapshots(client, req.auth.clinicId, req.params.patientId, req.query.before, req.query.after)
    );
    res.json(changes);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/teeth/:id/history', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const chain = await withTenantClient(req.auth.clinicId, (client) => odontogramService.getToothVersionChain(client, req.auth.clinicId, req.params.id));
    res.json(chain);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
