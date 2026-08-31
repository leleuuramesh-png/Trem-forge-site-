// netlify/functions/stripe-subscribe.js
//
// POST /.netlify/functions/stripe-subscribe
// Body JSON: { "plan": "pro" | "business" }
//
// Cria (ou reaproveita) um Customer na Stripe pro usuário logado e uma
// Checkout Session em modo "subscription", devolvendo a URL de checkout
// (session.url) pra ele entrar com o cartão e assinar em US$.
//
// Assim como no fluxo do Mercado Pago, a assinatura só vira "active" de
// verdade quando o webhook (stripe-webhook.js) confirmar o evento
// checkout.session.completed / customer.subscription.updated — aqui a
// gente só inicia o checkout.
//
// Requer os Price IDs cadastrados no Dashboard da Stripe (Products >
// Pricing) nas env vars STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS — a
// Stripe não aceita criar uma assinatura só com um valor solto como o
// Mercado Pago aceita, precisa de um Price pré-cadastrado.

const Stripe = require('stripe');
const {
  usersStore,
  stripeCustomersStore,
  getRawSessionUser,
  addActivity,
  json,
  PLAN_CONFIG,
  getStripePriceId,
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

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'JSON inválido' });
  }

  const planKey = String(data.plan || '').trim();
  const plan = PLAN_CONFIG[planKey];
  if (!plan) {
    return json(400, { error: 'Plano inválido. Use "pro" ou "business".' });
  }

  const priceId = getStripePriceId(planKey);
  if (!priceId) {
    return json(500, {
      error: `Stripe ainda não configurado pro plano ${plan.label} (falta STRIPE_PRICE_${planKey.toUpperCase()} no ambiente).`,
    });
  }

  const user = raw.user;

  console.log('stripe-subscribe: pedido de assinatura —', user.email, '| plano solicitado =', planKey, '| status atual =', user.planStatus);

  if (user.planStatus === 'active' || user.planStatus === 'pending') {
    console.log('stripe-subscribe: bloqueado — usuário', user.email, 'já tem assinatura', user.planStatus, 'em', user.planProvider || 'algum provedor');
    return json(409, { error: 'Você já tem uma assinatura ativa ou pendente. Cancele-a antes de assinar de novo.' });
  }

  const siteUrl = (process.env.SITE_URL || `https://${event.headers.host}`).replace(/\/$/, '');

  // Reaproveita o Customer da Stripe se o usuário já assinou antes
  // (mesmo que a assinatura anterior tenha sido cancelada) — evita
  // duplicar o cadastro de cliente a cada nova tentativa.
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await stripeCustomersStore().set(customerId, user.email);
      user.stripeCustomerId = customerId;
      await usersStore().setJSON(user.email, user);
      console.log('stripe-subscribe: customer Stripe criado —', customerId, 'para', user.email);
    } catch (err) {
      console.error('stripe-subscribe: falha ao criar customer na Stripe:', err);
      return json(502, { error: 'Não foi possível falar com a Stripe agora. Tente novamente.' });
    }
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { plan: planKey, userId: user.id },
      subscription_data: { metadata: { plan: planKey, userId: user.id } },
      success_url: `${siteUrl}/painel.html?assinatura=ok`,
      cancel_url: `${siteUrl}/painel.html?assinatura=cancelada`,
    });
    console.log('stripe-subscribe: checkout session criada —', session.id);
  } catch (err) {
    console.error('stripe-subscribe: falha ao criar checkout session:', err);
    return json(502, { error: 'Não foi possível iniciar o checkout da Stripe agora. Tente novamente.' });
  }

  user.plan = planKey;
  user.planStatus = 'pending';
  user.planProvider = 'stripe';
  user.planCurrency = 'USD';
  addActivity(user, 'plan', 'plan_started_usd', { plan: plan.label });
  await usersStore().setJSON(user.email, user);

  console.log('stripe-subscribe: usuário', user.email, 'salvo com planStatus = pending | provider = stripe');

  const { passwordHash, ...safeUser } = user;
  return json(200, {
    ok: true,
    checkoutUrl: session.url,
    user: safeUser,
  });
};
