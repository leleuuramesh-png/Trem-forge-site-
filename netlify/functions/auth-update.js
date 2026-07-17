// netlify/functions/auth-update.js
//
// POST /.netlify/functions/auth-update
// Body JSON: { "name": "..." }
//
// Atualiza dados simples de perfil do usuário logado (por enquanto, só o
// nome de exibição). Protegido por sessão (cookie tf_session).

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

  const name = String(data.name || '').trim();
  if (!name || name.length < 2) {
    return json(400, { error: 'Informe um nome válido.' });
  }
  if (name.length > 60) {
    return json(400, { error: 'Nome muito longo.' });
  }

  const user = raw.user;
  const changed = user.name !== name;
  user.name = name;
  if (changed) {
    addActivity(user, 'profile', 'Nome de exibição atualizado.');
  }

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
