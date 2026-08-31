// netlify/functions/stripe-reactivate.js
//
// POST /.netlify/functions/stripe-reactivate
//
// Desfaz um cancelamento agendado (stripe-cancel.js) enquanto o usuário
// ainda estiver dentro do ciclo já pago. Só funciona se a assinatura
// ainda não tiver sido efetivamente encerrada pela Stripe.

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

  if (!user.stripeSubscriptionId || user.planStatus === 'canceled') {
    return json(400, { error: 'Não há nenhum cancelamento agendado pra desfazer.' });
  }

  if (!user.cancelAtPeriodEnd) {
    const { passwordHash, ...safeUser } = user;
    return json(200, { ok: true, alreadyActive: true, user: safeUser });
  }

  try {
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  } catch (err) {
    console.error('stripe-reactivate: falha ao reativar assinatura na Stripe:', err);
    return json(502, { error: 'Não foi possível reativar agora. Tente novamente ou fale com o suporte.' });
  }

  const planLabel = (PLAN_CONFIG[user.plan] && PLAN_CONFIG[user.plan].label) || user.plan;
  user.cancelAtPeriodEnd = false;
  user.planCancelAt = null;
  // Mesma proteção usada em stripe-cancel.js: carimba "agora" pra
  // bloquear qualquer webhook zumbi antigo que tente reverter essa
  // reativação via stripe-webhook.js.
  user.stripeLastEventAt = Math.floor(Date.now() / 1000);
  addActivity(user, 'plan', 'plan_reactivated_usd', { plan: planLabel });

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
