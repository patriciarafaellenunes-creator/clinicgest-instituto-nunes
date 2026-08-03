// src/routes/supplierContracts.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const supplierContractService = require('../services/supplierContractService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof supplierContractService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      supplierContractService.createSupplierContract(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:documentId', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      supplierContractService.getSupplierContractWithTerms(client, req.auth.clinicId, req.params.documentId)
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/suppliers/:supplierId/active', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      supplierContractService.getActiveSupplierContract(client, req.auth.clinicId, req.params.supplierId, { category: req.query.category })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
