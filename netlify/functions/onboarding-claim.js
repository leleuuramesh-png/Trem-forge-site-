// netlify/functions/onboarding-claim.js
//
// POST /.netlify/functions/onboarding-claim
// Body JSON: { "step": "profile" }
//
// Marca um passo do checklist de onboarding como concluído e credita a
// recompensa uma única vez por usuário. Passos suportados:
//   - "profile": completar nome (>=2 palavras) — precisa vir preenchido
//                em auth-me antes de chamar isso; aqui só valida o nome
//                já salvo no registro do usuário.

const {
  usersStore,
  getRawSessionUser,
  addActivity,
  json,
} = require('./_lib/auth');

const STEPS = {
  profile: { reward: 30, label: 'Perfil completo' },
};

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

  const step = String(data.step || '');
  const def = STEPS[step];
  if (!def) return json(400, { error: 'Passo inválido.' });

  const user = raw.user;
  user.onboarding = user.onboarding || {};

  if (user.onboarding[step]) {
    return json(200, { ok: true, alreadyClaimed: true, coinsBalance: user.coinsBalance });
  }

  if (step === 'profile' && String(user.name || '').trim().split(/\s+/).length < 2) {
    return json(400, { error: 'Preencha nome e sobrenome no perfil antes de resgatar.' });
  }

  user.onboarding[step] = true;
  user.coinsBalance = (user.coinsBalance || 0) + def.reward;
  addActivity(user, 'onboarding', `${def.label} — +${def.reward} créditos.`);

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, coinsBalance: user.coinsBalance, user: safeUser });
};
