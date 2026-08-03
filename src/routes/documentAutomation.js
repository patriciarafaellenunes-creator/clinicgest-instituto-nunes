// src/routes/documentAutomation.js
const express = require('express');
const { withTenantClient, pool, setTenantContext } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const documentAutomationService = require('../services/documentAutomationService');
const documentAgentService = require('../services/documentAgentService');

const router = express.Router();
router.use(requireAuth);

router.post('/treatment-plans/:id/approve-with-documents', requirePermission('budgets', 'approve'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      documentAutomationService.approveTreatmentPlanWithAutomation(client, { planId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(422).json({ error: err.message, code: err.code || 'DOMAIN_ERROR' });
  }
});

router.post('/contracts/notify-expiring', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const notifications = await withTenantClient(req.auth.clinicId, (client) =>
      documentAutomationService.notifyExpiringContracts(client, { clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.status(201).json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/agent/ask', requirePermission('documents', 'view'), async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) return res.status(422).json({ error: 'Pergunta é obrigatória.' });

  const client = await pool.connect();
  try {
    await setTenantContext(client, req.auth.clinicId);
    const result = await documentAgentService.askDocumentAgent(client, { clinicId: req.auth.clinicId, question });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao consultar o agente.' });
  } finally {
    client.release();
  }
});

module.exports = router;
