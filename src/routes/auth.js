// src/routes/auth.js
const express = require('express');
const { withAuthClient } = require('../db/pool');
const authService = require('../services/authService');

const router = express.Router();

// ATENÇÃO: em produção, este endpoint não deve ficar aberto ao público sem
// alguma proteção (rate limiting, aprovação manual, convite, captcha) —
// qualquer pessoa que o encontrar pode criar uma clínica nova. Está aberto
// aqui porque, no MVP, sem ele não existe nenhuma forma de começar a usar o
// sistema (problema do ovo e da galinha: toda outra rota exige um JWT, e o
// JWT só existe depois de logar em um usuário que precisa já existir).
router.post('/bootstrap-clinic', async (req, res) => {
  try {
    const result = await withAuthClient((client) => authService.bootstrapClinic(client, req.body));
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof authService.DomainError) {
      return res.status(422).json({ error: err.message, code: err.code });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const result = await withAuthClient((client) => authService.login(client, req.body));
    res.json(result);
  } catch (err) {
    if (err instanceof authService.DomainError) {
      const status = err.code === 'INVALID_CREDENTIALS' ? 401 : 422;
      return res.status(status).json({ error: err.message, code: err.code });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
