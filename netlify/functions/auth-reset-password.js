// netlify/functions/auth-reset-password.js
//
// POST /.netlify/functions/auth-reset-password
// Body JSON: { "email": "...", "code": "123456", "password": "novaSenha" }

const {
  usersStore,
  normalizeEmail,
  verifyPasswordReset,
  hashPassword,
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

  const email = normalizeEmail(data.email);
  const code = String(data.code || '').trim();
  const password = String(data.password || '');

  if (!email || !code) {
    return json(400, { error: 'Informe o e-mail e o código recebido.' });
  }
  if (password.length < 8) {
    return json(400, { error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  }

  const check = await verifyPasswordReset(email, code);
  if (!check.ok) {
    return json(400, { error: check.error });
  }

  const store = usersStore();
  const user = await store.get(email, { type: 'json' });

  // O código já foi validado (e consumido) acima. Se o usuário sumiu
  // nesse meio tempo, ainda assim não vale a pena vazar detalhe.
  if (!user) {
    return json(400, { error: 'Não foi possível redefinir a senha. Solicite um novo código.' });
  }

  user.passwordHash = hashPassword(password);
  await store.setJSON(email, user);

  return json(200, { ok: true, message: 'Senha redefinida com sucesso. Você já pode entrar.' });
};
