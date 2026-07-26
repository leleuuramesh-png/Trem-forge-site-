// netlify/functions/auth-2fa-toggle.js
//
// POST /.netlify/functions/auth-2fa-toggle
// Body JSON: { "enable": true | false, "password": "..." }
//
// Liga/desliga a verificação em duas etapas pro usuário logado. Exige a
// senha atual — tanto pra ativar quanto pra desativar — porque desativar
// 2FA é justamente o tipo de ação que um invasor tentaria fazer depois
// de sequestrar uma sessão; confirmar a senha reduz esse risco.

const {
  getRawSessionUser,
  usersStore,
  verifyPassword,
  addActivity,
  ensureEngagementFields,
  json,
} = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const raw = await getRawSessionUser(event);
  if (!raw) {
    return json(401, { error: 'Sessão expirada. Faça login novamente.' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'JSON inválido' });
  }

  const enable = Boolean(data.enable);
  const password = String(data.password || '');

  if (!password) {
    return json(400, { error: 'Confirme sua senha para continuar.' });
  }

  const user = raw.user;
  if (!verifyPassword(password, user.passwordHash)) {
    return json(401, { error: 'Senha incorreta.' });
  }

  ensureEngagementFields(user);

  if (user.twoFactorEnabled === enable) {
    const { passwordHash, ...safeUser } = user;
    return json(200, { ok: true, user: safeUser });
  }

  user.twoFactorEnabled = enable;
  addActivity(user, 'security', enable
    ? 'Verificação em duas etapas ativada.'
    : 'Verificação em duas etapas desativada.');

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
