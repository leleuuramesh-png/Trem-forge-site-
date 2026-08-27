// netlify/functions/stripe-checkout.js
//
// POST /.netlify/functions/stripe-checkout
// Body JSON: { "package": "starter" | "popular" | "power" }
//
// Cria uma Checkout Session em modo "payment" (pagamento único, não
// recorrente) na Stripe pro usuário logado comprar um pacote de coins em
// US$, e devolve a URL de checkout (session.url).
//
// Equivalente em US$ ao mp-checkout.js (que faz a mesma coisa em R$ via
// Mercado Pago). Diferente da assinatura (stripe-subscribe.js), aqui não
// precisa de um Price pré-cadastrado no Dashboard — a Stripe aceita
// price_data com valor solto em modo "payment", então os 3 pacotes usam
// os valores de COIN_PACKAGES[*].priceUSD diretamente, sem precisar de
// nenhuma env var nova.
//
// Assim como no Mercado Pago, os coins só entram na conta quando o
// webhook (stripe-webhook.js, evento checkout.session.completed com
// mode "payment") confirmar — nunca no momento da criação da sessão.

const crypto = require('crypto');
const Stripe = require('stripe');
const {
  usersStore,
  stripeCustomersStore,
  stripeCheckoutsStore,
  getRawSessionUser,
  json,
  COIN_PACKAGES,
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

  const packageKey = String(data.package || '').trim();
  const pack = COIN_PACKAGES[packageKey];
  if (!pack || !pack.priceUSD) {
    return json(400, { error: 'Pacote inválido. Use "starter", "popular" ou "power".' });
  }

  const user = raw.user;

  // Um id único por tentativa de compra (mesmo espírito do purchaseId em
  // mp-checkout.js). Vai em metadata.purchaseId na Checkout Session e é o
  // que o webhook usa pra achar de volta o registro em stripeCheckoutsStore.
  const purchaseId = `coins_stripe_${user.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  console.log('stripe-checkout: pedido de compra —', user.email, '| pacote =', packageKey, '| purchaseId =', purchaseId);

  // Reaproveita o Customer da Stripe se o usuário já tem um (criado aqui
  // ou em stripe-subscribe.js) — evita duplicar cadastro de cliente.
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
      console.log('stripe-checkout: customer Stripe criado —', customerId, 'para', user.email);
    } catch (err) {
      console.error('stripe-checkout: falha ao criar customer na Stripe:', err);
      return json(502, { error: 'Não foi possível falar com a Stripe agora. Tente novamente.' });
    }
  }

  const siteUrl = (process.env.SITE_URL || `https://${event.headers.host}`).replace(/\/$/, '');

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(pack.priceUSD * 100), // Stripe trabalha em centavos
            product_data: {
              name: `Trem Forge — ${pack.coins} créditos (${pack.label})`,
            },
          },
          quantity: 1,
        },
      ],
      client_reference_id: user.id,
      metadata: { purchaseId, package: packageKey, userId: user.id },
      success_url: `${siteUrl}/checkout.html?compra=ok`,
      cancel_url: `${siteUrl}/checkout.html?compra=cancelada`,
    });
    console.log('stripe-checkout: checkout session criada —', session.id);
  } catch (err) {
    console.error('stripe-checkout: falha ao criar checkout session:', err);
    return json(502, { error: 'Não foi possível iniciar o checkout da Stripe agora. Tente novamente.' });
  }

  // Guarda o registro que o webhook vai buscar quando o pagamento for
  // confirmado. "credited: false" é o que impede creditar duas vezes.
  await stripeCheckoutsStore().setJSON(purchaseId, {
    email: user.email,
    package: packageKey,
    coins: pack.coins,
    sessionId: session.id,
    credited: false,
    createdAt: new Date().toISOString(),
  });

  console.log('stripe-checkout: registro salvo em stripeCheckoutsStore —', purchaseId);

  return json(200, {
    ok: true,
    checkoutUrl: session.url,
    purchaseId,
  });
};
