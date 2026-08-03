// src/routes/patients.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const patientsService = require('../services/patientsService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof patientsService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/', requirePermission('patients', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      patientsService.searchPatients(client, req.auth.clinicId, { query: req.query.q || '' })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:id', requirePermission('patients', 'view'), async (req, res) => {
  try {
    const profile = await withTenantClient(req.auth.clinicId, (client) =>
      patientsService.getPatientProfile(client, req.auth.clinicId, req.params.id)
    );
    res.json(profile);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('patients', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      patientsService.createPatient(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof patientsService.DomainError && err.code === 'POSSIBLE_DUPLICATE') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    handleDomainError(err, res);
  }
});

router.patch('/:id', requirePermission('patients', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      patientsService.updatePatient(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
