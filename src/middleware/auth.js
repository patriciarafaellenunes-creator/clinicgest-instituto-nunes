// src/middleware/auth.js
//
// MVP: valida um JWT emitido no login (não implementado neste módulo) e
// carrega clinic_id/user_id/permissions no req. Ações fora da unidade/clínica
// do usuário são bloqueadas aqui, antes de qualquer service rodar — isso é a
// segunda camada de defesa, além do row-level security no banco (seção 13 do
// plano mestre: "defesa em profundidade").

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
    req.auth = {
      userId: payload.sub,
      clinicId: payload.clinicId,
      permissions: payload.permissions || [], // ex: ['financial:view','financial:approve']
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function requirePermission(module, action) {
  return (req, res, next) => {
    const key = `${module}:${action}`;
    if (!req.auth || !req.auth.permissions.includes(key)) {
      return res.status(403).json({ error: `Permissão negada: ${key}` });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission };
