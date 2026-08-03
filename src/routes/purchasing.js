// src/routes/purchasing.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const purchasingService = require('../services/purchasingService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof purchasingService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/suppliers', requirePermission('purchasing', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      purchasingService.createSupplier(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/orders', requirePermission('purchasing', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => purchasingService.listPurchaseOrders(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/orders', requirePermission('purchasing', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      purchasingService.createPurchaseOrder(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/orders/:id', requirePermission('purchasing', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => purchasingService.getPurchaseOrderWithItems(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/orders/:id/approve', requirePermission('purchasing', 'approve'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      purchasingService.approvePurchaseOrder(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/orders/:id/receive', requirePermission('purchasing', 'edit'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      purchasingService.receivePurchaseOrder(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
