// src/routes/termsLibrary.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const termsLibraryService = require('../services/termsLibraryService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof termsLibraryService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/catalog', requirePermission('documents', 'view'), async (_req, res) => {
  // Catálogo padrão é estático (não depende de clínica) — só mostra o que está disponível para semear.
  res.json(termsLibraryService.STANDARD_TERMS_CATALOG.map((t) => ({ name: t.name, specialty: t.specialty })));
});

router.post('/seed', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const created = await withTenantClient(req.auth.clinicId, (client) =>
      termsLibraryService.seedStandardTerms(client, { clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json({ createdCount: created.length, created });
  } catch (err) { handleDomainError(err, res); }
});

router.post('/templates/:templateId/instantiate', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const document = await withTenantClient(req.auth.clinicId, (client) =>
      termsLibraryService.instantiateDocumentFromTemplate(client, {
        templateId: req.params.templateId, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body,
      })
    );
    res.status(201).json(document);
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
