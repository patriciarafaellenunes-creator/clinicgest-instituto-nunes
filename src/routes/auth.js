// src/routes/auth.js
const crypto = require('crypto');
const express = require('express');
const { withAuthClient } = require('../db/pool');
const authService = require('../services/authService');

const router = express.Router();

// Sem alguma proteção, qualquer pessoa que encontre esta URL pode criar uma
// clínica nova — ela precisa ficar aberta sem JWT (problema do ovo e da
// galinha: toda outra rota exige um token, e o token só existe depois de
// logar num usuário que precisa já existir), mas não aberta ao público.
// BOOTSTRAP_SETUP_TOKEN resolve isso com um segredo simples, só de posse de
// quem está configurando o sistema: sem a variável definida, a rota segue
// aberta como antes (dev local, suíte de teste); com ela definida (produção),
// toda chamada precisa enviar o mesmo valor em `setupToken` no corpo.
function setupTokenIsValid(req) {
  const expected = process.env.BOOTSTRAP_SETUP_TOKEN;
  if (!expected) return true;

  const provided = typeof req.body?.setupToken === 'string' ? req.body.setupToken : '';
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

router.post('/bootstrap-clinic', async (req, res) => {
  if (!setupTokenIsValid(req)) {
    return res.status(403).json({ error: 'Token de configuração inválido ou ausente.', code: 'INVALID_SETUP_TOKEN' });
  }
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
