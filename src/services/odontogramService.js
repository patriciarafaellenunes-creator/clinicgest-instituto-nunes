// src/services/odontogramService.js
//
// Mesmo padrão de imutabilidade da evolução clínica, aplicado por "slot"
// (dente + face). Cada slot tem sua própria cadeia de versões — mudar a
// condição de um dente/face nunca apaga o registro anterior, sempre cria uma
// nova versão encadeada (supersedes_id).
//
// "Comparação entre odontogramas anteriores" (seção do documento 2) é
// resolvida reconstruindo o estado de cada slot numa data específica: para
// cada (dente, face), pega a versão mais recente criada até aquela data —
// isso dá uma "foto" real do odontograma em qualquer ponto do histórico,
// sem precisar guardar snapshots duplicados.

const { logAudit } = require('./auditService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const VALID_CONDITIONS = [
  'ausente', 'carie', 'restauracao', 'coroa', 'implante', 'protese', 'fratura',
  'tratamento_endodontico', 'mobilidade', 'lesao', 'procedimento_indicado', 'higido',
];

// Cores/legendas sugeridas para o frontend renderizar o odontograma
// (seção "legendas e cores configuráveis" do documento 2). Fica no código,
// não no banco, porque é apresentação, não dado clínico.
const CONDITION_LEGEND = {
  higido: { label: 'Hígido', color: '#FFFFFF' },
  carie: { label: 'Cárie', color: '#DC2626' },
  restauracao: { label: 'Restauração', color: '#2563EB' },
  coroa: { label: 'Coroa', color: '#CA8A04' },
  implante: { label: 'Implante', color: '#7C3AED' },
  protese: { label: 'Prótese', color: '#0891B2' },
  fratura: { label: 'Fratura', color: '#EA580C' },
  tratamento_endodontico: { label: 'Tratamento endodôntico', color: '#DB2777' },
  mobilidade: { label: 'Mobilidade', color: '#65A30D' },
  lesao: { label: 'Lesão', color: '#B91C1C' },
  ausente: { label: 'Ausente', color: '#6B7280' },
  procedimento_indicado: { label: 'Procedimento indicado', color: '#F59E0B' },
};

/** Define (ou atualiza) a condição de um dente/face. Se já existir uma versão atual para esse slot, encadeia. */
async function setToothCondition(client, {
  clinicId, patientId, toothNumber, face, toothCondition, status, notes, professionalId, userId,
}) {
  if (!toothNumber) throw new DomainError('Número do dente é obrigatório.', 'MISSING_TOOTH');
  if (!VALID_CONDITIONS.includes(toothCondition)) {
    throw new DomainError(`Condição inválida: ${toothCondition}`, 'INVALID_CONDITION');
  }

  const { rows: currentRows } = await client.query(
    `SELECT * FROM odontogram_entries
     WHERE patient_id = $1 AND tooth_number = $2 AND ($3::text IS NULL AND face IS NULL OR face = $3) AND is_current = true`,
    [patientId, toothNumber, face || null]
  );
  const current = currentRows[0];
  const nextVersion = current ? current.version + 1 : 1;

  const { rows } = await client.query(
    `INSERT INTO odontogram_entries
      (clinic_id, patient_id, tooth_number, face, tooth_condition, status, notes, professional_id,
       version, supersedes_id, is_current, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
     RETURNING *`,
    [clinicId, patientId, toothNumber, face || null, toothCondition, status || 'realizado', notes || null,
     professionalId || null, nextVersion, current ? current.id : null, userId]
  );
  const record = rows[0];

  if (current) {
    await client.query(`UPDATE odontogram_entries SET is_current = false WHERE id = $1`, [current.id]);
  }

  await logAudit(client, {
    clinicId, userId, tableName: 'odontogram_entries', recordId: record.id,
    action: current ? 'update_version' : 'insert', beforeValue: current || null, afterValue: record,
  });

  return record;
}

async function getCurrentOdontogram(client, clinicId, patientId) {
  const { rows } = await client.query(
    `SELECT * FROM odontogram_entries WHERE clinic_id = $1 AND patient_id = $2 AND is_current = true
     ORDER BY tooth_number, face NULLS FIRST`,
    [clinicId, patientId]
  );
  return rows.map((r) => ({ ...r, legend: CONDITION_LEGEND[r.tooth_condition] || null }));
}

/** Reconstrói o estado do odontograma inteiro numa data específica (para comparação com o atual). */
async function getOdontogramAsOf(client, clinicId, patientId, asOfDate) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (tooth_number, face) *
     FROM odontogram_entries
     WHERE clinic_id = $1 AND patient_id = $2 AND created_at <= $3
     ORDER BY tooth_number, face NULLS FIRST, created_at DESC`,
    [clinicId, patientId, asOfDate]
  );
  return rows;
}

/** Compara dois pontos no tempo e retorna só os slots que mudaram (dente adicionado, removido ou com condição diferente). */
async function compareOdontogramSnapshots(client, clinicId, patientId, dateBefore, dateAfter) {
  const [before, after] = await Promise.all([
    getOdontogramAsOf(client, clinicId, patientId, dateBefore),
    getOdontogramAsOf(client, clinicId, patientId, dateAfter),
  ]);

  const slotKey = (e) => `${e.tooth_number}|${e.face || ''}`;
  const beforeMap = new Map(before.map((e) => [slotKey(e), e]));
  const afterMap = new Map(after.map((e) => [slotKey(e), e]));

  const changes = [];
  for (const [key, afterEntry] of afterMap) {
    const beforeEntry = beforeMap.get(key);
    if (!beforeEntry) {
      changes.push({ toothNumber: afterEntry.tooth_number, face: afterEntry.face, change: 'novo', before: null, after: afterEntry.tooth_condition });
    } else if (beforeEntry.tooth_condition !== afterEntry.tooth_condition) {
      changes.push({ toothNumber: afterEntry.tooth_number, face: afterEntry.face, change: 'alterado', before: beforeEntry.tooth_condition, after: afterEntry.tooth_condition });
    }
  }
  for (const [key, beforeEntry] of beforeMap) {
    if (!afterMap.has(key)) {
      changes.push({ toothNumber: beforeEntry.tooth_number, face: beforeEntry.face, change: 'removido', before: beforeEntry.tooth_condition, after: null });
    }
  }
  return changes;
}

async function getToothVersionChain(client, clinicId, entryId) {
  const { rows } = await client.query(`SELECT * FROM odontogram_entries WHERE id = $1 AND clinic_id = $2`, [entryId, clinicId]);
  let record = rows[0];
  if (!record) throw new DomainError('Registro do odontograma não encontrado.', 'NOT_FOUND');

  while (record.supersedes_id) {
    const { rows: parentRows } = await client.query(`SELECT * FROM odontogram_entries WHERE id = $1`, [record.supersedes_id]);
    record = parentRows[0];
  }

  const chain = [record];
  let current = record;
  while (true) {
    const { rows: nextRows } = await client.query(`SELECT * FROM odontogram_entries WHERE supersedes_id = $1`, [current.id]);
    if (nextRows.length === 0) break;
    current = nextRows[0];
    chain.push(current);
  }
  return chain;
}

module.exports = {
  DomainError, VALID_CONDITIONS, CONDITION_LEGEND,
  setToothCondition, getCurrentOdontogram, getOdontogramAsOf, compareOdontogramSnapshots, getToothVersionChain,
};
