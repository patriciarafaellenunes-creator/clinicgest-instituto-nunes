// src/routes/clinicalDocuments.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const clinicalDocumentsService = require('../services/clinicalDocumentsService');
const pdfService = require('../services/pdfService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof clinicalDocumentsService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/patients/:patientId/documents', requirePermission('clinical', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      clinicalDocumentsService.issueDocument(client, {
        ...req.body, patientId: req.params.patientId, clinicId: req.auth.clinicId, userId: req.auth.userId,
      })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/patients/:patientId/documents', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      clinicalDocumentsService.getPatientDocuments(client, req.auth.clinicId, req.params.patientId, { documentType: req.query.type })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/documents/:id', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => clinicalDocumentsService.getDocument(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/documents/:id/cancel', requirePermission('clinical', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      clinicalDocumentsService.cancelDocument(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/documents/:id/pdf', requirePermission('clinical', 'view'), async (req, res) => {
  try {
    const pdfBytes = await withTenantClient(req.auth.clinicId, async (client) => {
      const clinicalDocument = await clinicalDocumentsService.getDocument(client, req.auth.clinicId, req.params.id);

      const [clinicRow, patientRow, professionalRow] = await Promise.all([
        client.query('SELECT name FROM clinics WHERE id = $1', [req.auth.clinicId]),
        client.query('SELECT full_name FROM patients WHERE id = $1', [clinicalDocument.patient_id]),
        client.query('SELECT full_name FROM professionals WHERE id = $1', [clinicalDocument.professional_id]),
      ]);

      return pdfService.generateClinicalDocumentPdf({
        clinicalDocument,
        clinicName: clinicRow.rows[0] ? clinicRow.rows[0].name : null,
        patientName: patientRow.rows[0] ? patientRow.rows[0].full_name : null,
        professionalName: professionalRow.rows[0] ? professionalRow.rows[0].full_name : null,
      });
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="documento-clinico-${req.params.id}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
