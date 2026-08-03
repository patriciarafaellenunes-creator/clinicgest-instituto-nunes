// src/routes/inventory.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const inventoryService = require('../services/inventoryService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof inventoryService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/items', requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => inventoryService.listItems(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/items', requirePermission('inventory', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      inventoryService.createItem(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/items/:id/receive', requirePermission('inventory', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      inventoryService.receiveStock(client, { itemId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/items/:id/consume', requirePermission('inventory', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      inventoryService.consumeStock(client, { itemId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/items/:id/adjust', requirePermission('inventory', 'approve'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      inventoryService.adjustStock(client, { itemId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/items/:id/movements', requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => inventoryService.getItemMovementHistory(client, req.auth.clinicId, req.params.id));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/low-stock', requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => inventoryService.getLowStockItems(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/appointments/:id/consume', requirePermission('inventory', 'edit'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      inventoryService.consumeForAppointment(client, { appointmentId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
