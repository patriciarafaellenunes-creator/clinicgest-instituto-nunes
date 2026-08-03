// src/routes/agenda.js
const express = require('express');
const { withTenantClient } = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const agendaService = require('../services/agendaService');

const router = express.Router();
router.use(requireAuth);

function handleDomainError(err, res) {
  if (err instanceof agendaService.DomainError) {
    return res.status(422).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
}

router.get('/professional/:professionalId', requirePermission('agenda', 'view'), async (req, res) => {
  try {
    const rows = await withTenantClient(req.auth.clinicId, (client) =>
      agendaService.getAgendaByProfessional(client, req.auth.clinicId, {
        professionalId: req.params.professionalId, date: req.query.date,
      })
    );
    res.json(rows);
  } catch (err) { handleDomainError(err, res); }
});

router.get('/professional/:professionalId/idle-slots', requirePermission('agenda', 'view'), async (req, res) => {
  try {
    const slots = await withTenantClient(req.auth.clinicId, (client) =>
      agendaService.getIdleSlots(client, req.auth.clinicId, {
        professionalId: req.params.professionalId, date: req.query.date,
      })
    );
    res.json(slots);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/', requirePermission('agenda', 'create'), async (req, res) => {
  try {
    const result = await withTenantClient(req.auth.clinicId, (client) =>
      agendaService.createAppointment(client, { ...req.body, clinicId: req.auth.clinicId, userId: req.auth.userId })
    );
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof agendaService.DomainError && err.code === 'SCHEDULE_CONFLICT') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    handleDomainError(err, res);
  }
});

router.post('/:id/status', requirePermission('agenda', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      agendaService.updateAppointmentStatus(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) { handleDomainError(err, res); }
});

router.post('/:id/reschedule', requirePermission('agenda', 'edit'), async (req, res) => {
  try {
    const record = await withTenantClient(req.auth.clinicId, (client) =>
      agendaService.rescheduleAppointment(client, { id: req.params.id, clinicId: req.auth.clinicId, userId: req.auth.userId, ...req.body })
    );
    res.json(record);
  } catch (err) {
    if (err instanceof agendaService.DomainError && err.code === 'SCHEDULE_CONFLICT') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    handleDomainError(err, res);
  }
});

module.exports = router;
