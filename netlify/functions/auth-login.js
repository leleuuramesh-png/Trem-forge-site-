// netlify/functions/auth-login.js
//
// POST /.netlify/functions/auth-login
// Body JSON: { "email": "...", "password": "..." }

const {
  usersStore,
  normalizeEmail,
  verifyPassword,
  createSession,
  buildSessionCookie,
  json,
  touchDailyVisit,
} = require('./_lib/auth');

// Rate limiting simples por e-mail (evita força bruta) — em memória do
// processo da function. Não é robusto entre invocações frias, mas ajuda.
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyAttempts(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

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
  const password = String(data.password || '');

  if (!email || !password) {
    return json(400, { error: 'Informe e-mail e senha.' });
  }

  if (tooManyAttempts(email)) {
    return json(429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  }

  const store = usersStore();
  const user = await store.get(email, { type: 'json' });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(401, { error: 'E-mail ou senha incorretos.' });
  }

  const { changed } = touchDailyVisit(user);
  if (changed) {
    await store.setJSON(email, user);
  }

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
