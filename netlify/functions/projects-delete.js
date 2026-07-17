// netlify/functions/projects-delete.js
//
// POST /.netlify/functions/projects-delete
// Body JSON: { "id": "proj_..." }
//
// Remove um projeto da conta do usuário logado. Protegido por sessão
// (cookie tf_session); só apaga projetos que pertencem ao próprio usuário.

const {
  usersStore,
  getRawSessionUser,
  addActivity,
  json,
} = require('./_lib/auth');

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

  const idx = user.projects.findIndex((p) => p.id === id);
  if (idx === -1) return json(404, { error: 'Projeto não encontrado.' });

  const [removed] = user.projects.splice(idx, 1);
  addActivity(user, 'project', `Projeto removido: ${removed.name}`);

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
