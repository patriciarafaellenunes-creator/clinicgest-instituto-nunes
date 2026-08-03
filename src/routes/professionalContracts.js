// src/routes/professionalContracts.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const professionalContractService = require('../services/professionalContractService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof professionalContractService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      professionalContractService.createProfessionalContract(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:documentId', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      professionalContractService.getProfessionalContractWithTerms(client, req.auth.clinicId, req.params.documentId)
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/professionals/:professionalId/authorization', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      professionalContractService.isProfessionalAuthorized(client, req.auth.clinicId, req.params.professionalId, {
        procedureId: req.query.procedureId, specialty: req.query.specialty, unitId: req.query.unitId,
      })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
