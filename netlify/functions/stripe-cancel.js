// netlify/functions/stripe-cancel.js
//
// POST /.netlify/functions/stripe-cancel
//
// Agenda o cancelamento da assinatura pro FIM DO CICLO atual (não corta o
// acesso na hora — o cliente já pagou esse período, então continua Pro
// até a data de renovação e só para de ser cobrado depois). Pra reverter
// isso antes da data, veja stripe-reactivate.js.
//
// Atualizamos o registro local de forma otimista pra refletir na hora no
// painel — a confirmação definitiva ainda chega depois via webhook
// (stripe-webhook.js, evento customer.subscription.updated /
// customer.subscription.deleted), que é idempotente nesse caso.

const Stripe = require('stripe');
const {
  usersStore,
  getRawSessionUser,
  addActivity,
  json,
  PLAN_CONFIG,
} = require('./_lib/auth');

// API versions recentes da Stripe movem os timestamps do ciclo de
// cobrança pro nível do subscription item em vez do topo do subscription
// — tenta os dois lugares pra não quebrar se a versão da conta mudar.
function getPeriodEndUnix(subscription) {
  if (subscription.current_period_end) return subscription.current_period_end;
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  if (item && item.current_period_end) return item.current_period_end;
  return null;
}

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

  if (user.cancelAtPeriodEnd) {
    // Já está agendado pra cancelar — não precisa chamar a Stripe de novo.
    const { passwordHash, ...safeUser } = user;
    return json(200, { ok: true, alreadyCanceled: true, user: safeUser });
  }

  // Confere o status real na Stripe antes de tentar mexer. Isso evita um
  // erro feio pro usuário se o nosso registro local ficou desatualizado
  // (ex.: apontando pra uma subscription que já foi cancelada de outra
  // forma) — nesse caso, só sincronizamos o painel em vez de falhar.
  let currentSubscription;
  try {
    currentSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  } catch (err) {
    console.error('stripe-cancel: falha ao consultar assinatura na Stripe:', err);
    return json(502, { error: 'Não foi possível verificar sua assinatura agora. Tente novamente ou fale com o suporte.' });
  }

  if (currentSubscription.status === 'canceled') {
    console.warn('stripe-cancel: registro local desatualizado — subscription', user.stripeSubscriptionId, 'já estava cancelada na Stripe. Sincronizando.');
    const planLabel = (PLAN_CONFIG[user.plan] && PLAN_CONFIG[user.plan].label) || user.plan;
    user.planStatus = 'canceled';
    user.cancelAtPeriodEnd = false;
    user.planCancelAt = null;
    addActivity(user, 'plan', `Assinatura do plano ${planLabel} (US$) já estava cancelada — painel sincronizado.`);
    await usersStore().setJSON(user.email, user);
    const { passwordHash, ...safeUser } = user;
    return json(200, { ok: true, user: safeUser });
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    console.error('stripe-cancel: falha ao agendar cancelamento na Stripe:', err);
    return json(502, { error: 'Não foi possível cancelar a assinatura agora. Tente novamente ou fale com o suporte.' });
  }

  const planLabel = (PLAN_CONFIG[user.plan] && PLAN_CONFIG[user.plan].label) || user.plan;
  const periodEndUnix = getPeriodEndUnix(subscription);
  const periodEndIso = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;
  const dateLabel = periodEndIso
    ? new Date(periodEndIso).toLocaleDateString('pt-BR')
    : 'o fim do ciclo atual';

  // planStatus continua 'active' de propósito: o acesso não é cortado
  // agora, só a renovação futura é que não vai acontecer.
  user.cancelAtPeriodEnd = true;
  user.planCancelAt = periodEndIso;
  addActivity(user, 'plan', `Assinatura do plano ${planLabel} (US$) cancelada — acesso continua até ${dateLabel}, sem renovar depois.`);

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
