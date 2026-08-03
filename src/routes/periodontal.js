// src/routes/periodontal.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const periodontalService = require('../services/periodontalService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof periodontalService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/patients/:patientId/exams', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      periodontalService.createPeriodontalExam(client, {
        ...req.body, patientId: req.params.patientId, clinicId: req.auth.clinicId, userId: req.auth.userId,
      })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/exams', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => periodontalService.getPatientExamHistory(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/exams/:id', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => periodontalService.getExamWithMeasurements(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/exams/:id/correct', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      periodontalService.correctPeriodontalExam(client, { examId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/compare', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      periodontalService.compareExams(client, req.auth.clinicId, req.query.before, req.query.after)
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
