// netlify/functions/stripe-cancel.js
//
// POST /.netlify/functions/stripe-cancel
//
// Cancela a assinatura recorrente do usuário logado na Stripe.
// Atualizamos o registro local de forma otimista pra refletir na hora no
// painel — a confirmação definitiva ainda chega depois via webhook
// (stripe-webhook.js, evento customer.subscription.deleted), que é
// idempotente nesse caso.

const Stripe = require('stripe');
const {
  usersStore,
  getRawSessionUser,
  addActivity,
  json,
  PLAN_CONFIG,
} = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return json(500, { error: 'Stripe ainda não configurado (falta STRIPE_SECRET_KEY no ambiente).' });
  }
  const stripe = Stripe(secretKey);

  const raw = await getRawSessionUser(event);
  if (!raw) return json(401, { error: 'Não autenticado.' });

  const user = raw.user;

  if (!user.stripeSubscriptionId) {
    return json(400, { error: 'Você não tem nenhuma assinatura Stripe pra cancelar.' });
  }

  if (user.planStatus === 'canceled') {
    const { passwordHash, ...safeUser } = user;
    return json(200, { ok: true, alreadyCanceled: true, user: safeUser });
  }

  try {
    await stripe.subscriptions.cancel(user.stripeSubscriptionId);
  } catch (err) {
    console.error('stripe-cancel: falha ao cancelar assinatura na Stripe:', err);
    return json(502, { error: 'Não foi possível cancelar a assinatura agora. Tente novamente ou fale com o suporte.' });
  }

  const planLabel = (PLAN_CONFIG[user.plan] && PLAN_CONFIG[user.plan].label) || user.plan;
  user.planStatus = 'canceled';
  addActivity(user, 'plan', `Assinatura do plano ${planLabel} (US$) cancelada.`);

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
