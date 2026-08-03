// src/routes/agent.js
const express = require('express');
const { pool, setTenantContext } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const aiAgentService = require('../services/aiAgentService');

const router = express.Router();
router.use(requireAuth);

// O agente é somente leitura, mas os dados que ele expõe são financeiros —
// exige a mesma permissão de visualizar valores financeiros usada no dashboard.
router.post('/ask', requirePermission('financial', 'view_financial_values'), async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(422).json({ error: 'Pergunta é obrigatória.' });
  }

  const client = await pool.connect();
  try {
    await setTenantContext(client, req.auth.clinicId);
    const result = await aiAgentService.askFinancialAgent(client, {
      clinicId: req.auth.clinicId,
      question,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao consultar o agente.' });
  } finally {
    client.release();
  }
});

module.exports = router;
