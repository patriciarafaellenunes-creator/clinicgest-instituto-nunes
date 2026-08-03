// scripts/migrate-from-spreadsheet.js
//
// Lê o Sistema_Gestao_Clinica.xlsx (a planilha em produção) e importa os
// dados para o schema novo (02-schema-mvp.sql). Por padrão roda contra um
// banco simulado em memória (pg-mem, o mesmo simulador usado nos 23 testes
// do projeto) — nada de produção é tocado. Isso permite gerar o relatório
// de "o que seria importado" sem precisar de um Postgres real disponível.
//
// Uso:
//   node scripts/migrate-from-spreadsheet.js <caminho-para-o-xlsx>
//
// Abas ignoradas de propósito: Dashboard_DRE e Legenda são só leitura/
// fórmulas na planilha original — não têm dados próprios para migrar.
//
// Como cada aba se liga ao paciente/profissional/fornecedor: a planilha usa
// o NOME da pessoa/empresa (não o ID da linha) como referência entre abas —
// por isso este script resolve tudo por nome (normalizado, sem diferenciar
// maiúsculas/minúsculas), criando o cadastro correspondente automaticamente
// quando ele ainda não existe (profissional, fornecedor, procedimento,
// unidade, categoria financeira). Toda criação automática entra no
// relatório final para revisão.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Helpers de leitura da planilha
// ---------------------------------------------------------------------------

function loadWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheets = {};
  for (const name of wb.SheetNames) {
    if (name === 'Dashboard_DRE' || name === 'Legenda') continue; // só leitura/fórmulas
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  }
  return sheets;
}

function excelSerialToDateStr(n) {
  const d = XLSX.SSF.parse_date_code(n);
  return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}

function toDateString(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return excelSerialToDateStr(v);
  const s = String(v).trim();
  return s || null;
}

function toTimeString(v) {
  if (v === undefined || v === null || v === '') return '00:00';
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return `${String(d.H || 0).padStart(2, '0')}:${String(d.M || 0).padStart(2, '0')}`;
  }
  return String(v).trim();
}

function combineDateTime(dateVal, timeVal) {
  const dateStr = toDateString(dateVal);
  if (!dateStr) return null;
  const timeStr = toTimeString(timeVal);
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeStatus(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

function normName(s) { return String(s || '').trim(); }
function cacheKey(s) { return normName(s).toLowerCase(); }

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

class Report {
  constructor() {
    this.sheets = {};
    this.createdEntities = { professionals: [], suppliers: [], procedures: [], units: [], financialCategories: [] };
    this.notes = [];
    this.warnings = [];
  }
  sheet(name) {
    if (!this.sheets[name]) this.sheets[name] = { read: 0, imported: 0, skipped: [] };
    return this.sheets[name];
  }
}

// ---------------------------------------------------------------------------
// Resolução/criação de entidades referenciadas por nome
// ---------------------------------------------------------------------------

async function getOrCreateProfessional(client, ctx, report, rawName) {
  const name = normName(rawName);
  if (!name) return null;
  const key = cacheKey(name);
  if (ctx.professionalCache.has(key)) return ctx.professionalCache.get(key);

  const { rows: existing } = await client.query(
    `SELECT id FROM professionals WHERE clinic_id = $1 AND full_name = $2`, [ctx.clinicId, name]
  );
  let id;
  if (existing[0]) {
    id = existing[0].id;
  } else {
    const { rows } = await client.query(
      `INSERT INTO professionals (clinic_id, full_name, professional_role) VALUES ($1,$2,'dentista') RETURNING id`,
      [ctx.clinicId, name]
    );
    id = rows[0].id;
    report.createdEntities.professionals.push(name);
  }
  ctx.professionalCache.set(key, id);
  return id;
}

async function getOrCreateSupplier(client, ctx, report, rawName) {
  const name = normName(rawName);
  if (!name) return null;
  const key = cacheKey(name);
  if (ctx.supplierCache.has(key)) return ctx.supplierCache.get(key);

  const { rows: existing } = await client.query(
    `SELECT id FROM suppliers WHERE clinic_id = $1 AND legal_name = $2`, [ctx.clinicId, name]
  );
  let id;
  if (existing[0]) {
    id = existing[0].id;
  } else {
    const { rows } = await client.query(
      `INSERT INTO suppliers (clinic_id, legal_name) VALUES ($1,$2) RETURNING id`, [ctx.clinicId, name]
    );
    id = rows[0].id;
    report.createdEntities.suppliers.push(name);
  }
  ctx.supplierCache.set(key, id);
  return id;
}

async function getOrCreateProcedure(client, ctx, report, rawName, defaultPrice) {
  const name = normName(rawName) || 'Procedimento não especificado';
  const key = cacheKey(name);
  if (ctx.procedureCache.has(key)) return ctx.procedureCache.get(key);

  const { rows: existing } = await client.query(
    `SELECT id FROM procedures WHERE clinic_id = $1 AND name = $2`, [ctx.clinicId, name]
  );
  let id;
  if (existing[0]) {
    id = existing[0].id;
  } else {
    const { rows } = await client.query(
      `INSERT INTO procedures (clinic_id, name, default_price) VALUES ($1,$2,$3) RETURNING id`,
      [ctx.clinicId, name, defaultPrice || null]
    );
    id = rows[0].id;
    report.createdEntities.procedures.push(name);
  }
  ctx.procedureCache.set(key, id);
  return id;
}

async function getOrCreateUnit(client, ctx, report, rawName) {
  const name = normName(rawName) || 'Unidade Única';
  const key = cacheKey(name);
  if (ctx.unitCache.has(key)) return ctx.unitCache.get(key);

  const { rows: existing } = await client.query(
    `SELECT id FROM units WHERE clinic_id = $1 AND name = $2`, [ctx.clinicId, name]
  );
  let id;
  if (existing[0]) {
    id = existing[0].id;
  } else {
    const { rows } = await client.query(
      `INSERT INTO units (clinic_id, name) VALUES ($1,$2) RETURNING id`, [ctx.clinicId, name]
    );
    id = rows[0].id;
    report.createdEntities.units.push(name);
  }
  ctx.unitCache.set(key, id);
  return id;
}

async function getOrCreateFinancialCategory(client, ctx, report, rawName, type) {
  const name = normName(rawName) || 'Sem categoria';
  const key = cacheKey(name) + ':' + type;
  if (ctx.categoryCache.has(key)) return ctx.categoryCache.get(key);

  const { rows: existing } = await client.query(
    `SELECT id FROM financial_categories WHERE clinic_id = $1 AND name = $2 AND type = $3`, [ctx.clinicId, name, type]
  );
  let id;
  if (existing[0]) {
    id = existing[0].id;
  } else {
    const { rows } = await client.query(
      `INSERT INTO financial_categories (clinic_id, name, type) VALUES ($1,$2,$3) RETURNING id`,
      [ctx.clinicId, name, type]
    );
    id = rows[0].id;
    report.createdEntities.financialCategories.push(`${name} (${type})`);
  }
  ctx.categoryCache.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// Estrutura organizacional (empresa + clínica + unidade padrão)
// ---------------------------------------------------------------------------

async function ensureClinic(client, report, sheets, real) {
  const clinicName = 'Instituto Nunes';
  const { rows: companyRows } = await client.query(
    `INSERT INTO companies (legal_name) VALUES ($1) RETURNING id`, [clinicName]
  );
  const companyId = companyRows[0].id;
  const { rows: clinicRows } = await client.query(
    `INSERT INTO clinics (company_id, name) VALUES ($1,$2) RETURNING id`, [companyId, clinicName]
  );
  const clinicId = clinicRows[0].id;

  // Num Postgres real com RLS forçado (03-row-level-security.sql), toda
  // tabela com clinic_id só libera linhas depois que a sessão diz qual
  // clínica está "logada" — é o mesmo set_config que setTenantContext()
  // faz em src/db/pool.js a cada requisição da aplicação. `false` (em vez
  // de `true`) porque este script não abre uma transação só, então o valor
  // precisa durar a conexão inteira, não só uma transação.
  if (real) {
    await client.query(`SELECT set_config('app.current_clinic_id', $1, false)`, [clinicId]);
  }

  const ctx = {
    clinicId, companyId,
    professionalCache: new Map(),
    supplierCache: new Map(),
    procedureCache: new Map(),
    unitCache: new Map(),
    categoryCache: new Map(),
    patientNameMap: new Map(),
    patientIdMap: new Map(),
  };

  const firstUnitName = (sheets['Pacientes'] || []).map((r) => r['Unidade']).find(Boolean) || 'Unidade Única';
  ctx.defaultUnitId = await getOrCreateUnit(client, ctx, report, firstUnitName);

  return ctx;
}

// ---------------------------------------------------------------------------
// Importadores por aba
// ---------------------------------------------------------------------------

async function importPatients(client, rows, ctx, report) {
  const rep = report.sheet('Pacientes');
  for (const row of rows) {
    rep.read++;
    const name = normName(row['Nome']);
    if (!name) { rep.skipped.push({ id: row['ID'], reason: 'Sem nome' }); continue; }

    const cpf = normName(row['CPF']) || null;
    const unitId = await getOrCreateUnit(client, ctx, report, row['Unidade']);
    const professionalId = await getOrCreateProfessional(client, ctx, report, row['Profissional Responsável']);

    const { rows: existing } = cpf
      ? await client.query(`SELECT id FROM patients WHERE clinic_id = $1 AND cpf = $2`, [ctx.clinicId, cpf])
      : { rows: [] };

    let patientId;
    if (existing[0]) {
      patientId = existing[0].id;
      rep.skipped.push({ id: row['ID'], reason: `CPF já cadastrado — "${name}" não duplicado, reaproveitando o registro existente` });
    } else {
      const statusText = normName(row['Status']);
      const isActive = !/inativ|cancelad|desistiu/i.test(statusText);
      const notes = statusText ? `Status na planilha de origem: ${statusText}` : null;
      const { rows: inserted } = await client.query(
        `INSERT INTO patients (clinic_id, unit_id, full_name, cpf, phone, email, source, responsible_professional_id, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [ctx.clinicId, unitId, name, cpf, row['Telefone'] || null, row['E-mail'] || null, row['Origem'] || null,
         professionalId, notes, isActive]
      );
      patientId = inserted[0].id;
      rep.imported++;
    }
    if (row['ID']) ctx.patientIdMap.set(String(row['ID']), patientId);
    ctx.patientNameMap.set(cacheKey(name), patientId);
  }
}

async function importAgenda(client, rows, ctx, report) {
  const rep = report.sheet('Agenda');
  for (const row of rows) {
    rep.read++;
    const patientId = ctx.patientNameMap.get(cacheKey(row['Paciente']));
    if (!patientId) { rep.skipped.push({ id: row['ID'], reason: `Paciente "${row['Paciente']}" não encontrado na aba Pacientes` }); continue; }

    const startsAt = combineDateTime(row['Data'], row['Hora']);
    if (!startsAt) { rep.skipped.push({ id: row['ID'], reason: 'Data/hora inválida' }); continue; }
    const endsAt = new Date(startsAt.getTime() + 30 * 60000); // duração não informada na planilha — 30min padrão

    const professionalId = await getOrCreateProfessional(client, ctx, report, row['Profissional']);
    if (!professionalId) { rep.skipped.push({ id: row['ID'], reason: 'Sem profissional' }); continue; }
    const unitId = await getOrCreateUnit(client, ctx, report, row['Unidade']);
    const procedureId = await getOrCreateProcedure(client, ctx, report, row['Tipo'], null);
    const status = normalizeStatus(row['Status']) || 'agendado';

    await client.query(
      `INSERT INTO appointments (clinic_id, unit_id, patient_id, professional_id, procedure_id, starts_at, ends_at, status, cancel_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.clinicId, unitId, patientId, professionalId, procedureId, startsAt, endsAt, status, row['Motivo Cancelamento'] || null]
    );
    rep.imported++;
  }
}

const VALID_LEAD_STATUS = [
  'novo_lead', 'primeiro_contato', 'em_atendimento', 'avaliacao_agendada', 'avaliacao_confirmada',
  'avaliacao_realizada', 'orcamento_apresentado', 'em_negociacao', 'aguardando_decisao',
  'fechado', 'perdido', 'em_tratamento', 'pos_tratamento', 'reativacao',
];

async function importLeads(client, rows, ctx, report) {
  const rep = report.sheet('CRM_Leads');
  for (const row of rows) {
    rep.read++;
    const name = normName(row['Nome']);
    if (!name) { rep.skipped.push({ id: row['ID'], reason: 'Sem nome' }); continue; }

    const attendantName = normName(row['Atendente']);
    if (attendantName) {
      report.warnings.push(`Lead "${name}": atendente "${attendantName}" na planilha não corresponde a um usuário do sistema novo — importado sem responsável atribuído (atribua manualmente).`);
    }

    let status = normalizeStatus(row['Etapa']) || 'novo_lead';
    if (!VALID_LEAD_STATUS.includes(status)) {
      report.warnings.push(`Lead "${name}": etapa "${row['Etapa']}" não é uma das etapas padrão do funil — importada como texto livre ("${status}"), revise manualmente.`);
    }

    await client.query(
      `INSERT INTO leads (clinic_id, full_name, phone, procedure_interest, source, potential_value, status, next_action, next_action_date, loss_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ctx.clinicId, name, row['Telefone'] || null, row['Procedimento de Interesse'] || null, row['Origem'] || null,
       Number(row['Valor Potencial']) || null, status, row['Próxima Ação'] || null, toDateString(row['Data Próxima Ação']), row['Motivo da Perda'] || null]
    );
    rep.imported++;
  }
}

async function importBudgets(client, rows, ctx, report) {
  const rep = report.sheet('Orcamentos');
  for (const row of rows) {
    rep.read++;
    const patientId = ctx.patientNameMap.get(cacheKey(row['Paciente']));
    if (!patientId) { rep.skipped.push({ id: row['ID'], reason: `Paciente "${row['Paciente']}" não encontrado na aba Pacientes` }); continue; }

    const amount = Number(row['Valor']) || 0;
    if (amount <= 0) { rep.skipped.push({ id: row['ID'], reason: 'Valor inválido' }); continue; }

    const professionalId = await getOrCreateProfessional(client, ctx, report, row['Profissional']);
    const procedureId = await getOrCreateProcedure(client, ctx, report, row['Procedimento'], amount);
    const status = normalizeStatus(row['Status']) || 'rascunho';
    const createdAtStr = toDateString(row['Data']);

    const { rows: budgetRows } = await client.query(
      `INSERT INTO budgets (clinic_id, unit_id, patient_id, professional_id, status, total_amount, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [ctx.clinicId, ctx.defaultUnitId, patientId, professionalId, status, amount, createdAtStr ? new Date(createdAtStr) : new Date()]
    );
    await client.query(
      `INSERT INTO budget_items (budget_id, procedure_id, quantity, unit_price, discount, total) VALUES ($1,$2,1,$3,0,$3)`,
      [budgetRows[0].id, procedureId, amount]
    );
    rep.imported++;
  }
}

async function importReceivables(client, rows, ctx, report) {
  const rep = report.sheet('Financeiro_Receber');
  for (const row of rows) {
    rep.read++;
    const patientId = ctx.patientNameMap.get(cacheKey(row['Paciente']));
    if (!patientId) { rep.skipped.push({ id: row['ID'], reason: `Paciente "${row['Paciente']}" não encontrado na aba Pacientes` }); continue; }

    const dueDate = toDateString(row['Vencimento']);
    const amount = Number(row['Valor']) || 0;
    if (!dueDate || amount <= 0) { rep.skipped.push({ id: row['ID'], reason: 'Vencimento ou valor inválido' }); continue; }

    const status = normalizeStatus(row['Status']) || 'pendente';
    await client.query(
      `INSERT INTO accounts_receivable (clinic_id, patient_id, description, competence_date, due_date, amount, status)
       VALUES ($1,$2,$3,$4,$4,$5,$6)`,
      [ctx.clinicId, patientId, row['Descrição'] || null, dueDate, amount, status]
    );
    rep.imported++;
  }
  report.notes.push('Financeiro_Receber: a planilha não tem uma data de competência separada do vencimento — usei o vencimento para as duas (regime de caixa e competência ficam iguais na importação; ajuste manualmente se precisar do regime de competência real).');
}

async function importPayables(client, rows, ctx, report) {
  const rep = report.sheet('Financeiro_Pagar');
  for (const row of rows) {
    rep.read++;
    const dueDate = toDateString(row['Vencimento']);
    const amount = Number(row['Valor']) || 0;
    if (!dueDate || amount <= 0) { rep.skipped.push({ id: row['ID'], reason: 'Vencimento ou valor inválido' }); continue; }

    const supplierId = await getOrCreateSupplier(client, ctx, report, row['Fornecedor']);
    const categoryId = await getOrCreateFinancialCategory(client, ctx, report, row['Categoria'], 'despesa');
    const status = normalizeStatus(row['Status']) || 'pendente';
    const natureRaw = normName(row['Natureza (DRE)']).toLowerCase();
    const costNature = natureRaw.startsWith('vari') ? 'variavel' : natureRaw.startsWith('fix') ? 'fixo' : null;

    await client.query(
      `INSERT INTO accounts_payable (clinic_id, supplier_id, category_id, description, competence_date, due_date, amount, status, cost_nature)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)`,
      [ctx.clinicId, supplierId, categoryId, row['Descrição'] || null, dueDate, amount, status, costNature]
    );
    rep.imported++;
  }
}

async function importInventory(client, rows, ctx, report) {
  const rep = report.sheet('Estoque');
  for (const row of rows) {
    rep.read++;
    const name = normName(row['Item']);
    if (!name) { rep.skipped.push({ id: row['ID'], reason: 'Sem nome do item' }); continue; }

    await client.query(
      `INSERT INTO inventory_items (clinic_id, unit_id, name, category, unit_of_measure, current_quantity, min_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.clinicId, ctx.defaultUnitId, name, row['Categoria'] || null, row['Unidade'] || null,
       Number(row['Qtd Atual']) || 0, Number(row['Estoque Mínimo']) || 0]
    );
    rep.imported++;
  }
  report.notes.push('Estoque: a coluna "Status" (ex.: "Crítico") não foi migrada como texto — o sistema novo calcula isso sozinho comparando quantidade atual com o estoque mínimo, sempre atualizado.');
}

async function importTeamCommissions(client, rows, ctx, report) {
  const rep = report.sheet('Equipe_Comissoes');
  for (const row of rows) {
    rep.read++;
    const name = normName(row['Profissional']);
    if (!name) { rep.skipped.push({ id: row['ID'], reason: 'Sem nome do profissional' }); continue; }

    await getOrCreateProfessional(client, ctx, report, name);
    report.notes.push(
      `Equipe_Comissoes — ${name}: ${row['Tipo de Vínculo'] || '-'}, ${row['Tipo de Comissão'] || '-'} ` +
      `${row['Valor Comissão (% ou R$)'] || ''} — só o cadastro do profissional foi migrado. O percentual/tipo de comissão ` +
      `corresponde a um CONTRATO formal no sistema novo (módulo de Contratos de Profissionais), que exige assinatura — ` +
      `não é gerado automaticamente a partir da planilha. "Produção Aprovada"/"Comissão Estimada" não foram migrados ` +
      `porque são valores calculados; o sistema novo recalcula isso a partir dos recebimentos reais.`
    );
    rep.imported++;
  }
}

async function importDailyShifts(client, rows, ctx, report) {
  const rep = report.sheet('Diarias');
  for (const row of rows) {
    rep.read++;
    const shiftDate = toDateString(row['Data']);
    const amount = Number(row['Valor']) || 0;
    const serviceType = normName(row['Tipo de Atendimento']);
    if (!shiftDate || amount <= 0 || !serviceType) {
      rep.skipped.push({ id: row['ID'], reason: 'Data, tipo de atendimento ou valor inválido' });
      continue;
    }

    const professionalId = await getOrCreateProfessional(client, ctx, report, row['Profissional']);
    if (!professionalId) { rep.skipped.push({ id: row['ID'], reason: 'Sem profissional' }); continue; }
    const unitId = await getOrCreateUnit(client, ctx, report, row['Unidade']);
    const status = normalizeStatus(row['Status']) || 'pendente';

    await client.query(
      `INSERT INTO professional_daily_shifts (clinic_id, unit_id, professional_id, specialty, shift_date, service_type, amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.clinicId, unitId, professionalId, row['Especialidade'] || null, shiftDate, serviceType, amount, status]
    );
    rep.imported++;
  }
}

async function importDocuments(client, rows, ctx, report) {
  const rep = report.sheet('Documentos');
  for (const row of rows) {
    rep.read++;
    const categoriaRaw = normName(row['Categoria']).toLowerCase();
    const partyType = categoriaRaw === 'paciente' ? 'patient'
      : categoriaRaw === 'profissional' ? 'professional'
      : (categoriaRaw === 'fornecedor' || categoriaRaw.startsWith('laborat')) ? 'supplier'
      : null;
    if (!partyType) { rep.skipped.push({ id: row['ID'], reason: `Categoria "${row['Categoria']}" não reconhecida (esperado Paciente/Profissional/Fornecedor/Laboratório)` }); continue; }

    const linkedName = normName(row['Vinculado a']);
    let patientId = null, professionalId = null, supplierId = null;
    if (partyType === 'patient') {
      patientId = ctx.patientNameMap.get(cacheKey(linkedName));
      if (!patientId) { rep.skipped.push({ id: row['ID'], reason: `Paciente "${linkedName}" não encontrado na aba Pacientes` }); continue; }
    } else if (partyType === 'professional') {
      professionalId = await getOrCreateProfessional(client, ctx, report, linkedName);
    } else {
      supplierId = await getOrCreateSupplier(client, ctx, report, linkedName);
    }

    const status = normalizeStatus(row['Status']) || 'rascunho';
    const createdAtStr = toDateString(row['Criado em']);
    const content = `[Migrado da planilha de produção] Tipo: ${row['Tipo de Documento'] || '-'}. ` +
      `Este texto é apenas uma referência do controle antigo — não é o conteúdo jurídico completo do documento ` +
      `e não tem validade jurídica por si só.`;

    await client.query(
      `INSERT INTO documents (clinic_id, category, party_type, patient_id, professional_id, supplier_id, content, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.clinicId, row['Tipo de Documento'] || 'documento_migrado', partyType, patientId, professionalId, supplierId,
       content, status, createdAtStr ? new Date(createdAtStr) : new Date()]
    );
    rep.imported++;
  }
  report.notes.push('Documentos: o conteúdo migrado é só uma referência de controle (tipo + status) — o texto jurídico completo de cada contrato/termo não existia na planilha e precisa ser criado no módulo de Documentos quando for usar de verdade.');
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function setUpPgMem() {
  const { newDb } = require('pg-mem');
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', implementation: () => randomUUID(), impure: true });

  let schema = fs.readFileSync(path.join(__dirname, '..', '02-schema-mvp.sql'), 'utf8');
  schema = schema.replace(/CREATE EXTENSION.*\n/g, '');
  db.public.none(schema);

  const { Client } = db.adapters.createPg();
  const client = new Client();
  await client.connect();
  return client;
}

// Conecta num Postgres real (ex: o banco de teste no Supabase), usando as
// mesmas variáveis de ambiente do resto do sistema (ver src/db/pool.js).
// Usa a role app_user (a mesma que a aplicação usa em produção) — não o
// superusuário — então respeita a mesma política de RLS que já foi
// validada em test-integration/rls-real-postgres.test.js.
async function setUpRealPostgres() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.PGHOST,
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  return client;
}

async function runMigration(filePath, { real = false } = {}) {
  const sheets = loadWorkbook(filePath);
  const report = new Report();
  const client = real ? await setUpRealPostgres() : await setUpPgMem();

  const ctx = await ensureClinic(client, report, sheets, real);

  await importPatients(client, sheets['Pacientes'] || [], ctx, report);
  await importAgenda(client, sheets['Agenda'] || [], ctx, report);
  await importLeads(client, sheets['CRM_Leads'] || [], ctx, report);
  await importBudgets(client, sheets['Orcamentos'] || [], ctx, report);
  await importReceivables(client, sheets['Financeiro_Receber'] || [], ctx, report);
  await importPayables(client, sheets['Financeiro_Pagar'] || [], ctx, report);
  await importInventory(client, sheets['Estoque'] || [], ctx, report);
  await importTeamCommissions(client, sheets['Equipe_Comissoes'] || [], ctx, report);
  await importDailyShifts(client, sheets['Diarias'] || [], ctx, report);
  await importDocuments(client, sheets['Documentos'] || [], ctx, report);

  await client.end();
  report.clinicId = ctx.clinicId;
  return report;
}

function printReport(report, real) {
  const lines = [];
  lines.push('# Relatório de migração — Sistema_Gestao_Clinica.xlsx');
  lines.push('');
  lines.push(real
    ? `Rodado contra o banco de TESTE real no Supabase (clinic_id ${report.clinicId}) — não é o banco de produção final, mas os dados agora existem de verdade, protegidos pela mesma política de isolamento entre clínicas (RLS) que a aplicação usa.`
    : 'Rodado contra um banco de TESTE simulado em memória — nenhum dado real foi tocado.');
  lines.push('');
  lines.push('## Resumo por aba');
  for (const [name, s] of Object.entries(report.sheets)) {
    lines.push(`- **${name}**: ${s.read} linha(s) lida(s), ${s.imported} importada(s), ${s.skipped.length} não importada(s)`);
  }
  lines.push('');

  const anySkipped = Object.values(report.sheets).some((s) => s.skipped.length > 0);
  if (anySkipped) {
    lines.push('## Linhas não importadas (com o motivo)');
    for (const [name, s] of Object.entries(report.sheets)) {
      if (s.skipped.length === 0) continue;
      lines.push(`### ${name}`);
      const shown = s.skipped.slice(0, 20);
      for (const item of shown) lines.push(`- ${item.id || '(sem ID)'}: ${item.reason}`);
      if (s.skipped.length > shown.length) lines.push(`- ...e mais ${s.skipped.length - shown.length}`);
      lines.push('');
    }
  }

  lines.push('## Cadastros criados automaticamente (não existiam ainda)');
  for (const [kind, names] of Object.entries(report.createdEntities)) {
    if (names.length === 0) continue;
    lines.push(`- **${kind}** (${names.length}): ${names.join(', ')}`);
  }
  lines.push('');

  if (report.warnings.length > 0) {
    lines.push('## Avisos — revisar manualmente');
    const uniqueWarnings = [...new Set(report.warnings)];
    for (const w of uniqueWarnings.slice(0, 30)) lines.push(`- ${w}`);
    if (uniqueWarnings.length > 30) lines.push(`- ...e mais ${uniqueWarnings.length - 30}`);
    lines.push('');
  }

  if (report.notes.length > 0) {
    lines.push('## Notas sobre decisões de mapeamento');
    for (const n of [...new Set(report.notes)]) lines.push(`- ${n}`);
    lines.push('');
  }

  const text = lines.join('\n');
  console.log(text);
  return text;
}

module.exports = { runMigration, printReport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const real = args.includes('--real');
  const filePath = args.find((a) => !a.startsWith('--'));
  if (!filePath) {
    console.error('Uso: node scripts/migrate-from-spreadsheet.js <caminho-para-o-xlsx> [--real]');
    console.error('  --real  grava no Postgres real definido no .env, em vez do simulador em memória.');
    process.exit(1);
  }
  runMigration(filePath, { real })
    .then((report) => {
      const text = printReport(report, real);
      const outPath = path.join(__dirname, '..', real ? 'migration-report-real.md' : 'migration-report.md');
      fs.writeFileSync(outPath, text, 'utf8');
      console.log(`\nRelatório também salvo em: ${outPath}`);
    })
    .catch((err) => {
      console.error('Erro na migração:', err);
      process.exit(1);
    });
}
