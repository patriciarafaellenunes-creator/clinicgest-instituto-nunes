// src/routes/eSignature.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const documentsService = require('../services/documentsService');
const pdfService = require('../services/pdfService');
const eSignatureProviderService = require('../services/eSignatureProviderService');

const router = express.Router();
router.use(requireAuth);

router.post('/documents/:id/send-for-signature', requirePermission('documents', 'edit'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, async (client) => {
      const document = await documentsService.getDocumentWithSignatures(client, req.auth.clinicId, req.params.id);

      const pendingSigners = document.signatures.filter((s) => s.status === 'pendente');
      if (pendingSigners.length === 0) {
        throw new Error('Este documento não tem signatários pendentes.');
      }
      for (const s of pendingSigners) {
        if (!s.signer_email) throw new Error(`Signatário "${s.signer_name}" não tem e-mail cadastrado — obrigatório para enviar pela Clicksign.`);
      }

      const [clinicRow, patientRow, professionalRow] = await Promise.all([
        client.query('SELECT name FROM clinics WHERE id = $1', [req.auth.clinicId]),
        document.patient_id ? client.query('SELECT full_name FROM patients WHERE id = $1', [document.patient_id]) : { rows: [] },
        document.professional_id ? client.query('SELECT full_name FROM professionals WHERE id = $1', [document.professional_id]) : { rows: [] },
      ]);

      const pdfBytes = await pdfService.generateDocumentPdf({
        document, signatures: document.signatures,
        clinicName: clinicRow.rows[0]?.name,
        patientName: patientRow.rows[0]?.full_name,
        professionalName: professionalRow.rows[0]?.full_name,
      });

      const envelopeName = `${document.category} — ${patientRow.rows[0]?.full_name || document.id}`;
      const clicksignResult = await eSignatureProviderService.sendDocumentForSignature(
        pdfBytes, envelopeName,
        pendingSigners.map((s) => ({ name: s.signer_name, email: s.signer_email }))
      );

      // Guarda o id do envelope pra reconhecer esse documento quando o webhook chegar depois.
      await client.query(`UPDATE documents SET external_signature_id = $1 WHERE id = $2`, [clicksignResult.envelopeId, document.id]);

      return clicksignResult;
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(422).json({ error: err.message });
  }
});

module.exports = router;
