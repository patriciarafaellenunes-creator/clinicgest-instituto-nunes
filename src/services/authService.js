// src/services/authService.js
//
// Fecha a lacuna que existia desde o início do projeto: até agora,
// middleware/auth.js validava um JWT, mas nada no sistema emitia um. Este
// service resolve duas coisas:
//
// 1. bootstrapClinic — o problema do "ovo e da galinha": criar a primeira
//    clínica e o primeiro usuário sem já ter um token de autenticação. Só
//    deve ser chamado uma vez por clínica nova; em produção isso normalmente
//    fica atrás de um convite/aprovação, não aberto ao público (ver nota no
//    router).
// 2. login — verifica a senha (hash bcrypt, nunca texto puro) e emite um
//    JWT contendo a lista de permissões já resolvida (module:action), na
//    mesma forma que middleware/auth.js espera em req.auth.permissions.
//
// As tabelas usadas (users, roles, permissions, user_roles) já existem
// desde o schema da Fase 1 — este service não cria nada novo no banco.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const SALT_ROUNDS = 12;

// Todas as combinações módulo:ação realmente usadas nas rotas do sistema —
// gerada a partir de um grep sobre requirePermission(...) em src/routes.
// O perfil "Proprietário" recebe todas elas.
const ALL_PERMISSIONS = [
  ['agenda', 'create'], ['agenda', 'edit'], ['agenda', 'view'],
  ['bank_accounts', 'create'], ['bank_accounts', 'view'],
  ['budgets', 'approve'], ['budgets', 'create'], ['budgets', 'edit'], ['budgets', 'view'],
  ['clinical', 'create'], ['clinical', 'edit'], ['clinical', 'view'],
  ['daily_shifts', 'create'], ['daily_shifts', 'edit'], ['daily_shifts', 'view'],
  ['documents', 'create'], ['documents', 'edit'], ['documents', 'view'],
  ['financial', 'approve'], ['financial', 'create'], ['financial', 'edit'], ['financial', 'view'], ['financial', 'view_financial_values'],
  ['inventory', 'approve'], ['inventory', 'create'], ['inventory', 'edit'], ['inventory', 'view'],
  ['lab_orders', 'create'], ['lab_orders', 'edit'], ['lab_orders', 'view'],
  ['leads', 'create'], ['leads', 'edit'], ['leads', 'view'],
  ['patients', 'create'], ['patients', 'edit'], ['patients', 'view'],
  ['procedures', 'create'], ['procedures', 'view'],
  ['professionals', 'create'], ['professionals', 'view'],
  ['purchasing', 'approve'], ['purchasing', 'create'], ['purchasing', 'edit'], ['purchasing', 'view'],
  ['suppliers', 'create'], ['suppliers', 'view'],
  ['units', 'view'],
];

function toSafeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}

/**
 * Cria a primeira clínica e o primeiro usuário (perfil Proprietário, com
 * todas as permissões). Roda numa única transação — se qualquer parte
 * falhar, nada fica pela metade.
 */
async function bootstrapClinic(client, {
  companyLegalName, companyCnpj, clinicName, unitName, ownerFullName, ownerEmail, ownerPassword,
}) {
  if (!companyLegalName || !clinicName || !ownerFullName || !ownerEmail || !ownerPassword) {
    throw new DomainError('Razão social, nome da clínica, nome/e-mail/senha do proprietário são obrigatórios.', 'MISSING_FIELDS');
  }
  if (ownerPassword.length < 8) {
    throw new DomainError('A senha precisa ter ao menos 8 caracteres.', 'WEAK_PASSWORD');
  }

  const { rows: companyRows } = await client.query(
    `INSERT INTO companies (legal_name, cnpj) VALUES ($1,$2) RETURNING *`,
    [companyLegalName, companyCnpj || null]
  );
  const company = companyRows[0];

  const { rows: clinicRows } = await client.query(
    `INSERT INTO clinics (company_id, name) VALUES ($1,$2) RETURNING *`,
    [company.id, clinicName]
  );
  const clinic = clinicRows[0];

  // A partir daqui, todo INSERT toca tabelas protegidas por row-level
  // security (ver 03-row-level-security.sql), que exige clinic_id = o
  // valor da sessão. Como a clínica acabou de ser criada nesta mesma
  // transação, definimos o contexto agora — não existe outro jeito de
  // "provar" que este processo tem permissão de povoar uma clínica nova,
  // então isso só é seguro porque bootstrap-clinic é, por natureza, o único
  // momento em que uma clínica ainda não tem nenhum usuário/dado protegido.
  await client.query(`SELECT set_config('app.current_clinic_id', $1, true)`, [clinic.id]);

  const { rows: unitRows } = await client.query(
    `INSERT INTO units (clinic_id, name) VALUES ($1,$2) RETURNING *`,
    [clinic.id, unitName || 'Unidade Principal']
  );
  const unit = unitRows[0];

  const { rows: roleRows } = await client.query(
    `INSERT INTO roles (clinic_id, name, description) VALUES ($1,'Proprietário','Acesso completo a todos os módulos') RETURNING *`,
    [clinic.id]
  );
  const ownerRole = roleRows[0];

  for (const [module, action] of ALL_PERMISSIONS) {
    await client.query(`INSERT INTO permissions (role_id, module, action) VALUES ($1,$2,$3)`, [ownerRole.id, module, action]);
  }

  const passwordHash = await bcrypt.hash(ownerPassword, SALT_ROUNDS);
  const { rows: userRows } = await client.query(
    `INSERT INTO users (clinic_id, full_name, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING *`,
    [clinic.id, ownerFullName, ownerEmail.toLowerCase().trim(), passwordHash]
  );
  const user = userRows[0];

  await client.query(`INSERT INTO user_roles (user_id, role_id, unit_id) VALUES ($1,$2,NULL)`, [user.id, ownerRole.id]);

  return { company, clinic, unit, role: ownerRole, user: toSafeUser(user) };
}

async function getUserPermissions(client, userId) {
  const { rows } = await client.query(
    `SELECT DISTINCT p.module, p.action FROM permissions p
     JOIN user_roles ur ON ur.role_id = p.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  return rows.map((r) => `${r.module}:${r.action}`);
}

/**
 * Autentica por e-mail/senha e emite um JWT com as permissões já
 * resolvidas. Como o schema permite o mesmo e-mail em clínicas diferentes
 * (UNIQUE é por clinic_id + email, não global), se o e-mail existir em mais
 * de uma clínica é preciso informar clinicId explicitamente.
 */
async function login(client, { email, password, clinicId }) {
  if (!email || !password) throw new DomainError('E-mail e senha são obrigatórios.', 'MISSING_CREDENTIALS');

  const params = [email.toLowerCase().trim()];
  let clinicFilter = '';
  if (clinicId) {
    params.push(clinicId);
    clinicFilter = ' AND clinic_id = $2';
  }
  const { rows: candidates } = await client.query(
    `SELECT * FROM users WHERE email = $1 AND is_active = true${clinicFilter}`,
    params
  );

  if (candidates.length === 0) throw new DomainError('E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');
  if (candidates.length > 1) {
    throw new DomainError('Este e-mail existe em mais de uma clínica — informe clinicId para desambiguar.', 'AMBIGUOUS_EMAIL');
  }

  const user = candidates[0];
  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) throw new DomainError('E-mail ou senha inválidos.', 'INVALID_CREDENTIALS');

  const permissions = await getUserPermissions(client, user.id);

  const token = jwt.sign(
    { sub: user.id, clinicId: user.clinic_id, permissions },
    process.env.JWT_SECRET || 'dev-secret-change-me',
    { expiresIn: '12h' }
  );

  return { token, user: toSafeUser(user), permissions };
}

module.exports = { DomainError, bootstrapClinic, login, getUserPermissions, ALL_PERMISSIONS };
