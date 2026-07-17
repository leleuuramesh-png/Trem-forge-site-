// netlify/functions/projects-update.js
//
// POST /.netlify/functions/projects-update
// Body JSON: { "id": "proj_...", "name": "...", "description": "...", "status": "...", "link": "..." }
//
// Edita um projeto já existente na conta do usuário logado. Só altera
// projetos que pertencem ao próprio usuário (busca pelo id dentro de
// user.projects). Protegido por sessão (cookie tf_session).

const {
  usersStore,
  getRawSessionUser,
  addActivity,
  json,
  PROJECT_STATUSES,
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

  const id = String(data.id || '').trim();
  if (!id) return json(400, { error: 'Projeto não informado.' });

  const user = raw.user;
  if (!Array.isArray(user.projects)) user.projects = [];
  const project = user.projects.find((p) => p.id === id);
  if (!project) return json(404, { error: 'Projeto não encontrado.' });

  const name = String(data.name || '').trim();
  if (!name || name.length < 2) {
    return json(400, { error: 'Dê um nome ao projeto (mínimo 2 caracteres).' });
  }
  if (name.length > 80) {
    return json(400, { error: 'Nome muito longo (máximo 80 caracteres).' });
  }

  const description = String(data.description || '').trim().slice(0, 500);

  const status = String(data.status || project.status).trim();
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

  const statusChanged = project.status !== status;
  project.name = name;
  project.description = description;
  project.status = status;
  project.link = link;
  project.updatedAt = new Date().toISOString();

  if (statusChanged) {
    addActivity(user, 'project', `Projeto "${name}" mudou de status: ${PROJECT_STATUSES[status].label}.`);
  } else {
    addActivity(user, 'project', `Projeto "${name}" atualizado.`);
  }

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, project, user: safeUser });
};
