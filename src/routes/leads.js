// src/routes/leads.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const leadsService = require('../services/leadsService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof leadsService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/', requirePermission('leads', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      leadsService.listLeads(client, req.auth.clinicId, { status: req.query.status })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('leads', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      leadsService.createLead(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/interactions', requirePermission('leads', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      leadsService.logInteraction(client, { leadId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/status', requirePermission('leads', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      leadsService.updateLeadStatus(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/stale', requirePermission('leads', 'view'), async (req, res) => {
  try {
    const hours = parseInt(req.query.hours || '48', 10);
    const rows = await withTenantClient(req.auth.clinicId, (client) => leadsService.getStaleLeads(client, req.auth.clinicId, hours));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/funnel', requirePermission('leads', 'view'), async (req, res) => {
  try {
    const summary = await withTenantClient(req.auth.clinicId, (client) => leadsService.getFunnelSummary(client, req.auth.clinicId));
    res.json(summary);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
