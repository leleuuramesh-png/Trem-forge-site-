// netlify/functions/stripe-webhook.js
//
// POST /.netlify/functions/stripe-webhook
//
// Endpoint público que a Stripe chama sempre que algo muda numa
// assinatura (checkout concluído, renovação, cancelamento, falha de
// cobrança). Precisa ser cadastrado no Dashboard da Stripe (Developers >
// Webhooks) apontando pra esta URL, escutando pelo menos os eventos:
//   - checkout.session.completed
//   - customer.subscription.updated
//   - customer.subscription.deleted
//
// O "Signing secret" gerado nesse cadastro vai na env var
// STRIPE_WEBHOOK_SECRET — é o que valida que a notificação veio mesmo da
// Stripe (stripe.webhooks.constructEvent já cuida da verificação HMAC,
// sem precisar reimplementar como fizemos manualmente pro Mercado Pago).
//
// Sempre responde 200 depois de processar (mesmo em eventos que a gente
// decide ignorar), pra a Stripe não ficar re-tentando. Só devolve 400
// quando a assinatura do webhook não bate.

const Stripe = require('stripe');
const {
  usersStore,
  stripeCustomersStore,
  stripeCheckoutsStore,
  ensureEngagementFields,
  addActivity,
  json,
  PLAN_CONFIG,
} = require('./_lib/auth');

const STATUS_MAP = {
  active: 'active',
  trialing: 'active',
  past_due: 'pending',
  incomplete: 'pending',
  incomplete_expired: 'canceled',
  paused: 'paused',
  canceled: 'canceled',
  unpaid: 'canceled',
};

// Acha o e-mail do dono a partir do customer id da Stripe, usando o
// índice criado em stripe-subscribe.js.
async function findEmailByCustomer(customerId) {
  if (!customerId) return null;
  return stripeCustomersStore().get(customerId, { type: 'text' });
}

async function updateUserPlan(email, updates, activityMessage) {
  const user = await usersStore().get(email, { type: 'json' });
  if (!user) {
    console.error('stripe-webhook: usuário', email, 'não encontrado no usersStore.');
    return;
  }
  ensureEngagementFields(user);

  const changed = user.planStatus !== updates.planStatus;
  Object.assign(user, updates);
  if (changed && activityMessage) {
    addActivity(user, 'plan', activityMessage);
  }

  await usersStore().setJSON(email, user);
  console.log('stripe-webhook: usuário', email, 'atualizado — planStatus =', updates.planStatus, '| mudou?', changed);
}

// Trata checkout.session.completed em modo "payment" — compra avulsa de
// coins em US$ feita via stripe-checkout.js. A própria Checkout Session
// já vem com payment_status confirmado pela Stripe antes desse evento
// disparar, então (diferente do mp-webhook.js) não precisamos buscar o
// pagamento de novo numa segunda chamada — só conferir payment_status.
async function handleCoinsPaymentCompleted(session) {
  const purchaseId = session.metadata && session.metadata.purchaseId;
  console.log(
    'stripe-webhook (coins): session =', session.id,
    '| payment_status =', session.payment_status,
    '| purchaseId =', purchaseId
  );

  if (!purchaseId) {
    console.warn('stripe-webhook (coins): sem metadata.purchaseId — ignorado.');
    return json(200, { ok: true });
  }

  const purchase = await stripeCheckoutsStore().get(purchaseId, { type: 'json' });
  if (!purchase) {
    console.error('stripe-webhook (coins): nenhum registro encontrado para', purchaseId);
    return json(200, { ok: true });
  }

  if (purchase.credited) {
    console.log('stripe-webhook (coins): compra', purchaseId, 'já foi creditada antes — ignorado (idempotência).');
    return json(200, { ok: true });
  }

  if (session.payment_status !== 'paid') {
    console.log('stripe-webhook (coins): payment_status', session.payment_status, '— ainda não pago, nada a creditar.');
    return json(200, { ok: true });
  }

  const user = await usersStore().get(purchase.email, { type: 'json' });
  if (!user) {
    console.error('stripe-webhook (coins): usuário', purchase.email, 'não encontrado no usersStore.');
    return json(200, { ok: true });
  }

  user.coinsBalance = (user.coinsBalance || 0) + purchase.coins;
  addActivity(user, 'coins', `+${purchase.coins} créditos comprados em US$ (${purchase.package}). 🪙`);

  await usersStore().setJSON(purchase.email, user);

  purchase.credited = true;
  purchase.creditedAt = new Date().toISOString();
  await stripeCheckoutsStore().setJSON(purchaseId, purchase);

  console.log(
    'stripe-webhook (coins): creditado com sucesso —', purchase.email,
    '| +', purchase.coins, 'coins | novo saldo =', user.coinsBalance
  );

  return json(200, { ok: true });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error('stripe-webhook: STRIPE_SECRET_KEY ou STRIPE_WEBHOOK_SECRET não configurados — notificação ignorada.');
    return json(200, { ok: true }); // evita retry infinito enquanto não configurar
  }
  const stripe = Stripe(secretKey);

  const signature = (event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature'])) || null;
  if (!signature) {
    console.error('stripe-webhook: header stripe-signature ausente.');
    return json(400, { error: 'Assinatura ausente.' });
  }

  // A verificação de assinatura da Stripe precisa dos bytes EXATOS do
  // corpo recebido — se o Netlify entregou em base64 (comum quando o
  // corpo é tratado como binário), precisa decodificar antes de validar.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  let stripeEvent;
  try {
    stripeEvent = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('stripe-webhook: assinatura inválida, notificação descartada:', err.message);
    return json(400, { error: 'Assinatura inválida.' });
  }

  console.log('stripe-webhook: evento recebido —', stripeEvent.type, '| id =', stripeEvent.id);

  const obj = stripeEvent.data.object;

  if (stripeEvent.type === 'checkout.session.completed') {
    if (obj.mode === 'payment') {
      return handleCoinsPaymentCompleted(obj);
    }
    if (obj.mode !== 'subscription') {
      console.log('stripe-webhook: checkout.session.completed em modo', obj.mode, '— ignorado.');
      return json(200, { ok: true });
    }
    const email = await findEmailByCustomer(obj.customer);
    if (!email) {
      console.error('stripe-webhook: não achei o e-mail do customer', obj.customer);
      return json(200, { ok: true });
    }
    const planKey = (obj.metadata && obj.metadata.plan) || null;
    const planLabel = (PLAN_CONFIG[planKey] && PLAN_CONFIG[planKey].label) || planKey;
    await updateUserPlan(email, {
      plan: planKey,
      planStatus: 'active',
      planProvider: 'stripe',
      planCurrency: 'USD',
      stripeCustomerId: obj.customer,
      stripeSubscriptionId: obj.subscription,
    }, `Assinatura do plano ${planLabel} (US$) confirmada. 🎉`);
    return json(200, { ok: true });
  }

  if (stripeEvent.type === 'customer.subscription.updated' || stripeEvent.type === 'customer.subscription.deleted') {
    const email = await findEmailByCustomer(obj.customer);
    if (!email) {
      console.error('stripe-webhook: não achei o e-mail do customer', obj.customer);
      return json(200, { ok: true });
    }

    const isDeleted = stripeEvent.type === 'customer.subscription.deleted';
    const newStatus = isDeleted ? 'canceled' : (STATUS_MAP[obj.status] || obj.status);
    const planKey = (obj.metadata && obj.metadata.plan) || null;
    const planLabel = (PLAN_CONFIG[planKey] && PLAN_CONFIG[planKey].label) || planKey;

    const messages = {
      active: `Assinatura do plano ${planLabel} (US$) confirmada. 🎉`,
      paused: `Assinatura do plano ${planLabel} (US$) pausada.`,
      canceled: `Assinatura do plano ${planLabel} (US$) cancelada.`,
      pending: `Assinatura do plano ${planLabel} (US$) com pagamento pendente.`,
    };

    await updateUserPlan(email, {
      plan: planKey,
      planStatus: newStatus,
      planProvider: 'stripe',
      planCurrency: 'USD',
      stripeCustomerId: obj.customer,
      stripeSubscriptionId: isDeleted ? null : obj.id,
    }, messages[newStatus]);
    return json(200, { ok: true });
  }

  console.log('stripe-webhook: evento', stripeEvent.type, 'não tratado — ignorado.');
  return json(200, { ok: true });
};
