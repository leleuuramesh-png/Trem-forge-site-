// netlify/functions/auth-signup.js
//
// Cria uma nova conta (email + senha) e já inicia sessão (login automático).
//
// POST /.netlify/functions/auth-signup
// Body JSON: { "name": "...", "email": "...", "password": "..." }

const {
  usersStore,
  referralsStore,
  normalizeEmail,
  hashPassword,
  isValidEmail,
  createSession,
  buildSessionCookie,
  json,
  generateReferralCode,
  awardBadge,
  addActivity,
  applyReferral,
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

  const name = String(data.name || '').trim();
  const email = normalizeEmail(data.email);
  const password = String(data.password || '');

  if (!name || !email || !password) {
    return json(400, { error: 'Preencha nome, e-mail e senha.' });
  }
  if (!isValidEmail(email)) {
    return json(400, { error: 'E-mail inválido.' });
  }
  if (password.length < 8) {
    return json(400, { error: 'A senha precisa ter no mínimo 8 caracteres.' });
  }

  const store = usersStore();

  const existing = await store.get(email, { type: 'json' });
  if (existing) {
    return json(409, { error: 'Já existe uma conta com esse e-mail.' });
  }

  const id = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const user = {
    id,
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    // Campos usados pelas próximas etapas (assinatura e coins):
    plan: null,             // 'starter' | 'pro' | 'business' | null
    planStatus: null,       // 'active' | 'canceled' | 'past_due' | null
    planProvider: null,     // 'mercadopago' | 'stripe' | null
    planCurrency: null,     // 'BRL' | 'USD' | null
    coinsBalance: 0,
    // Engajamento: sequência de visitas, insígnias, atividade, indicação.
    streak: 1,
    lastVisit: new Date().toISOString().slice(0, 10),
    badges: [],
    activity: [],
    referralCode: generateReferralCode(id),
    referralCount: 0,
    referredBy: null,
  };

  awardBadge(user, 'boas_vindas');
  addActivity(user, 'login', 'Conta criada — bem-vindo(a) ao Trem Forge!');

  // Se veio de um link de indicação (?ref=CODE), credita quem indicou.
  const refCode = String(data.ref || '').trim();
  if (refCode) {
    await applyReferral(user, refCode);
  }

  try {
    await store.setJSON(email, user);
    await referralsStore().set(user.referralCode, email);
  } catch (err) {
    console.error('Erro salvando usuário:', err);
    return json(500, { error: 'Erro ao criar conta. Tente novamente.' });
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
