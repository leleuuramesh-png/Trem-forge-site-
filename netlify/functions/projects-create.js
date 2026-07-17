// netlify/functions/projects-create.js
//
// POST /.netlify/functions/projects-create
// Body JSON: { "name": "...", "description": "...", "status": "ideia", "link": "..." }
//
// Cria um projeto na conta do usuário logado (CRUD de acompanhamento —
// não gera código de verdade, é só o registro/organização dos projetos
// do usuário). Protegido por sessão (cookie tf_session).

const {
  usersStore,
  getRawSessionUser,
  addActivity,
  awardBadge,
  json,
  PROJECT_STATUSES,
  MAX_PROJECTS_PER_USER,
  generateProjectId,
} = require('./_lib/auth');

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const raw = await getRawSessionUser(event);
  if (!raw) return json(401, { error: 'Não autenticado.' });

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'JSON inválido' });
  }

  const name = String(data.name || '').trim();
  if (!name || name.length < 2) {
    return json(400, { error: 'Dê um nome ao projeto (mínimo 2 caracteres).' });
  }
  if (name.length > 80) {
    return json(400, { error: 'Nome muito longo (máximo 80 caracteres).' });
  }

  const description = String(data.description || '').trim().slice(0, 500);

  const status = String(data.status || 'ideia').trim();
  if (!PROJECT_STATUSES[status]) {
    return json(400, { error: 'Status inválido.' });
  }

  let link = String(data.link || '').trim();
  if (link && !isValidUrl(link)) {
    return json(400, { error: 'Informe um link válido (começando com http:// ou https://).' });
  }
  if (link.length > 300) {
    return json(400, { error: 'Link muito longo.' });
  }

  const user = raw.user;
  if (!Array.isArray(user.projects)) user.projects = [];

  if (user.projects.length >= MAX_PROJECTS_PER_USER) {
    return json(400, { error: `Limite de ${MAX_PROJECTS_PER_USER} projetos por conta atingido.` });
  }

  const now = new Date().toISOString();
  const project = {
    id: generateProjectId(),
    name,
    description,
    status,
    link,
    createdAt: now,
    updatedAt: now,
  };

  user.projects.unshift(project);
  addActivity(user, 'project', `Projeto criado: ${name}`);

  if (user.projects.length === 1) {
    awardBadge(user, 'primeiro_projeto');
  }

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, project, user: safeUser });
};
