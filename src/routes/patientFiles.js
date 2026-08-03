// src/routes/patientFiles.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const patientFilesService = require('../services/patientFilesService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof patientFilesService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/patients/:patientId/files', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      patientFilesService.registerFile(client, { ...req.body, patientId: req.params.patientId, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/files', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      patientFilesService.getPatientFiles(client, req.auth.clinicId, req.params.patientId, { category: req.query.category })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/files/unauthorized', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => patientFilesService.getUnauthorizedImages(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/files/:id/authorize-image', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      patientFilesService.setImageUsageAuthorization(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/files/:id/delete', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      patientFilesService.logicallyDeleteFile(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
