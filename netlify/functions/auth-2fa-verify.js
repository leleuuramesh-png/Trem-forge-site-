// netlify/functions/auth-2fa-verify.js
//
// POST /.netlify/functions/auth-2fa-verify
// Body JSON: { "pendingToken": "...", "code": "123456" }
//
// Segunda etapa do login quando o usuário tem 2FA ativado. auth-login.js
// já validou a senha e devolveu um pendingToken; aqui confirmamos o
// código de 6 dígitos enviado por e-mail e só então criamos a sessão de
// verdade (mesmo formato de cookie que o login normal).

const {
  usersStore,
  verifyTwoFactorCode,
  resolvePendingLogin,
  destroyPendingLogin,
  createSession,
  buildSessionCookie,
  touchDailyVisit,
  addActivity,
  ensureEngagementFields,
  json,
} = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'JSON inválido' });
  }

  const pendingToken = String(data.pendingToken || '').trim();
  const code = String(data.code || '').trim();

  if (!pendingToken || !code) {
    return json(400, { error: 'Informe o código de verificação.' });
  }

  const email = await resolvePendingLogin(pendingToken);
  if (!email) {
    return json(400, { error: 'Sessão de login expirada. Volte e tente entrar novamente.' });
  }

  const result = await verifyTwoFactorCode(email, code);
  if (!result.ok) {
    return json(401, { error: result.error });
  }

  await destroyPendingLogin(pendingToken);

  const store = usersStore();
  const user = await store.get(email, { type: 'json' });
  if (!user) {
    return json(404, { error: 'Conta não encontrada.' });
  }

  ensureEngagementFields(user);
  touchDailyVisit(user);
  addActivity(user, 'security', 'login_2fa_confirmed');
  await store.setJSON(email, user);

  const { token, expiresAt } = await createSession(user);
  const { passwordHash, ...safeUser } = user;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildSessionCookie(token, Math.floor((expiresAt - Date.now()) / 1000)),
    },
    body: JSON.stringify({ ok: true, user: safeUser }),
  };
};
