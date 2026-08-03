// src/routes/bankAccounts.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const bankAccountsService = require('../services/bankAccountsService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof bankAccountsService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/', requirePermission('bank_accounts', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => bankAccountsService.listBankAccounts(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('bank_accounts', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      bankAccountsService.createBankAccount(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
