// src/routes/documents.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const documentsService = require('../services/documentsService');
const pdfService = require('../services/pdfService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof documentsService.DomainError) {
    const status = err.code === 'DOCUMENT_LOCKED' ? 409 : 422;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.post('/templates', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      documentsService.createTemplate(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => documentsService.listDocuments(client, req.auth.clinicId));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      documentsService.createDocument(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:id', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) => documentsService.getDocumentWithSignatures(client, req.auth.clinicId, req.params.id));
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/status', requirePermission('documents', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      documentsService.updateDocumentStatus(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/signatures/:signatureId/sign', requirePermission('documents', 'edit'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      documentsService.recordSignature(client, {
        documentId: req.params.id, signatureId: req.params.signatureId, clinicId: req.auth.clinicId, userId: req.auth.userId,
        ipAddress: req.ip, ...req.body,
      })
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/revise', requirePermission('documents', 'create'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      documentsService.reviseDocument(client, { originalDocumentId: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.status(201).json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/pending/signatures', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => documentsService.getPendingSignatures(client, req.auth.clinicId, { patientId: req.query.patientId }));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/expiring/soon', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) => documentsService.getExpiringDocuments(client, req.auth.clinicId, parseInt(req.query.days || '30', 10)));
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/check/required/:patientId/:procedureId', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      documentsService.checkRequiredDocumentsForProcedure(client, req.auth.clinicId, req.params.patientId, req.params.procedureId)
    );
    res.json(result);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/:id/pdf', requirePermission('documents', 'view'), async (req, res) => {
  try {
    const pdfBytes = await withTenantClient(req.auth.clinicId, async (client) => {
      const document = await documentsService.getDocumentWithSignatures(client, req.auth.clinicId, req.params.id);

      const [clinicRow, patientRow, professionalRow, supplierRow] = await Promise.all([
        client.query('SELECT name FROM clinics WHERE id = $1', [req.auth.clinicId]),
        document.patient_id ? client.query('SELECT full_name FROM patients WHERE id = $1', [document.patient_id]) : { rows: [] },
        document.professional_id ? client.query('SELECT full_name FROM professionals WHERE id = $1', [document.professional_id]) : { rows: [] },
        document.supplier_id ? client.query('SELECT legal_name FROM suppliers WHERE id = $1', [document.supplier_id]) : { rows: [] },
      ]);

      return pdfService.generateDocumentPdf({
        document,
        signatures: document.signatures,
        clinicName: clinicRow.rows[0] ? clinicRow.rows[0].name : null,
        patientName: patientRow.rows[0] ? patientRow.rows[0].full_name : null,
        professionalName: professionalRow.rows[0] ? professionalRow.rows[0].full_name : null,
        supplierName: supplierRow.rows[0] ? supplierRow.rows[0].legal_name : null,
      });
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="documento-${req.params.id}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) { handleDomainError(err, res); }
});

module.exports = router;
