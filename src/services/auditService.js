// src/services/auditService.js
// Toda escrita relevante no financeiro passa por aqui. Isso é o que torna o
// audit_log confiável: em vez de cada rota lembrar de logar, o service de
// domínio (financialService) chama isso sempre que muda dinheiro de status.

async function logAudit(client, {
  clinicId,
  userId,
  tableName,
  recordId,
  action,
  beforeValue = null,
  afterValue = null,
  ipAddress = null,
}) {
  await client.query(
    `INSERT INTO audit_log
      (clinic_id, user_id, table_name, record_id, action, before_value, after_value, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      clinicId,
      userId,
      tableName,
      recordId,
      action,
      beforeValue ? JSON.stringify(beforeValue) : null,
      afterValue ? JSON.stringify(afterValue) : null,
      ipAddress,
    ]
  );
}

module.exports = { logAudit };
