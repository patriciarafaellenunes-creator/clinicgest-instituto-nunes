// src/routes/labOrders.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const labOrderService = require('../services/labOrderService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof labOrderService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/', requirePermission('lab_orders', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => labOrderService.listLabOrders(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('lab_orders', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      labOrderService.createLabOrder(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/status', requirePermission('lab_orders', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      labOrderService.updateLabOrderStatus(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/finalize', requirePermission('lab_orders', 'edit'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      labOrderService.finalizeLabOrder(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/overdue', requirePermission('lab_orders', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => labOrderService.getOverdueLabOrders(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId', requirePermission('lab_orders', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => labOrderService.getPatientLabOrders(client, req.auth.clinicId, req.params.patientId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
