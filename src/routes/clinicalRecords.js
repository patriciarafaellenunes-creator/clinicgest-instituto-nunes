// src/routes/clinicalRecords.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const clinicalRecordsService = require('../services/clinicalRecordsService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof clinicalRecordsService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

// ---- Anamnese ----

router.post('/patients/:patientId/anamnesis', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      clinicalRecordsService.createAnamnesisVersion(client, {
        ...req.body, patientId: req.params.patientId, clinicId: req.auth.clinicId, userId: req.auth.userId,
      })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/anamnesis', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => clinicalRecordsService.getCurrentAnamnesis(client, req.auth.clinicId, req.params.patientId));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/anamnesis/history', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => clinicalRecordsService.getAnamnesisHistory(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

// ---- Evolução clínica ----

router.post('/patients/:patientId/evolutions', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      clinicalRecordsService.addClinicalEvolution(client, {
        ...req.body, patientId: req.params.patientId, clinicId: req.auth.clinicId, userId: req.auth.userId,
      })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/evolutions', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => clinicalRecordsService.getPatientCurrentEvolutions(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/evolutions/:id/correct', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      clinicalRecordsService.correctClinicalEvolution(client, { evolutionId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/evolutions/:id/history', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const chain = await withTenantClient(req.auth.clinicId, (client) => clinicalRecordsService.getEvolutionVersionChain(client, req.auth.clinicId, req.params.id));
    res.json(chain);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
