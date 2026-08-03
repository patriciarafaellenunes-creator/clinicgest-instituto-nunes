// src/services/unitsService.js
//
// Só listagem por enquanto — a unidade é criada pelo bootstrap-clinic
// (authService), e a maioria das clínicas pequenas opera com uma unidade só.
// Isso existe porque appointments, budgets, inventory_items etc. exigem um
// unit_id, e não havia nenhum jeito de a API dizer ao frontend qual é.

async function listUnits(client, clinicId) {
  const { rows } = await client.query(
    `SELECT id, name, address, is_active FROM units WHERE clinic_id = $1 AND is_active = true ORDER BY name`,
    [clinicId]
  );
  return rows;
}

module.exports = { listUnits };
