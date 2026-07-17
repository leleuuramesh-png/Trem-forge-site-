// netlify/functions/favorites-toggle.js
//
// POST /.netlify/functions/favorites-toggle
// Body JSON: { "projectId": "...", "merge": ["id1","id2"] }
//
// Alterna um projeto favorito na conta do usuário logado. O campo opcional
// "merge" é usado uma única vez, no primeiro toggle após o login, pra
// importar favoritos que o visitante já tinha salvo localmente (localStorage)
// antes de entrar na conta.

const {
  usersStore,
  getRawSessionUser,
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

  const projectId = String(data.projectId || '').trim();
  const merge = Array.isArray(data.merge) ? data.merge.map(String) : [];

  const user = raw.user;
  if (!Array.isArray(user.favorites)) user.favorites = [];

  if (merge.length) {
    merge.forEach((id) => {
      if (id && !user.favorites.includes(id)) user.favorites.push(id);
    });
  }

  if (projectId) {
    const idx = user.favorites.indexOf(projectId);
    if (idx === -1) {
      user.favorites.push(projectId);
    } else {
      user.favorites.splice(idx, 1);
    }
  }

  await usersStore().setJSON(user.email, user);

  return json(200, { ok: true, favorites: user.favorites });
};
