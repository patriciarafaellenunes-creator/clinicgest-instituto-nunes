// src/routes/units.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const unitsService = require('../services/unitsService');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('units', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => unitsService.listUnits(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
