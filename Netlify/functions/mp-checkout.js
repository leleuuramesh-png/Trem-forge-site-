// netlify/functions/mp-checkout.js
//
// POST /.netlify/functions/mp-checkout
// Body JSON: { "package": "starter" | "popular" | "power" }
//
// Cria uma Preference (pagamento único, Checkout Pro) no Mercado Pago pra
// o usuário logado comprar um pacote de créditos avulsos e devolve a URL
// de checkout (init_point) pra ele pagar.
//
// Diferente de mp-subscribe.js (que cria uma Preapproval recorrente), aqui
// é um pagamento único: os créditos só entram na conta quando o Mercado
// Pago confirmar via webhook (mp-webhook.js, topic "payment") que o
// pagamento foi aprovado — nunca no momento da criação da preference.

const crypto = require('crypto');
const {
  getRawSessionUser,
  mpCheckoutsStore,
  json,
  COIN_PACKAGES,
} = require('./_lib/auth');

const MP_API = 'https://api.mercadopago.com';

function friendlyMpError(mpResponse) {
  const rawMessage = String((mpResponse && mpResponse.message) || '').toLowerCase();
  const causes = (mpResponse && Array.isArray(mpResponse.cause)) ? mpResponse.cause : [];
  const causeText = causes.map((c) => String(c.description || c.code || '')).join(' | ').toLowerCase();
  const haystack = `${rawMessage} ${causeText}`;

  if (haystack.includes('real or test users') || haystack.includes('same environment')) {
    return 'Não foi possível iniciar a compra: há uma incompatibilidade entre conta de teste e conta real do Mercado Pago. Fale com o suporte.';
  }
  if (haystack.includes("can't pay yourself") || haystack.includes('cannot be the same') || haystack.includes('collector')) {
    return 'Não é possível comprar usando o mesmo e-mail cadastrado como recebedor no Mercado Pago. Use outro e-mail de pagamento.';
  }
  if (haystack.includes('invalid') && haystack.includes('email')) {
    return 'O e-mail cadastrado na sua conta não é válido para o Mercado Pago. Verifique seu e-mail no seu perfil.';
  }

  return 'Não foi possível iniciar sua compra no Mercado Pago agora. Tente novamente em instantes ou fale com o suporte.';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return json(500, { error: 'Mercado Pago ainda não configurado (falta MP_ACCESS_TOKEN no ambiente).' });
  }

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
  if (!pack) {
    return json(400, { error: 'Pacote inválido. Use "starter", "popular" ou "power".' });
  }

  const user = raw.user;

  // Um id único por tentativa de compra (não por usuário/pacote — dá pra
  // comprar o mesmo pacote várias vezes, ao contrário da assinatura).
  // Vai como external_reference na preference e é o que o webhook usa
  // pra achar de volta o registro em mpCheckoutsStore.
  const purchaseId = `coins_${user.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  console.log('mp-checkout: pedido de compra —', user.email, '| pacote =', packageKey, '| purchaseId =', purchaseId);

  const siteUrl = (process.env.SITE_URL || `https://${event.headers.host}`).replace(/\/$/, '');

  const payload = {
    items: [
      {
        title: `Trem Forge — ${pack.coins} créditos (${pack.label})`,
        quantity: 1,
        unit_price: pack.priceBRL,
        currency_id: 'BRL',
      },
    ],
    payer: { email: user.email },
    external_reference: purchaseId,
    back_urls: {
      success: `${siteUrl}/checkout.html?compra=ok`,
      pending: `${siteUrl}/checkout.html?compra=pendente`,
      failure: `${siteUrl}/checkout.html?compra=falhou`,
    },
    auto_return: 'approved',
  };

  let mpResponse;
  try {
    console.log('mp-checkout: criando preference no Mercado Pago —', pack.label, '| valor =', pack.priceBRL);
    const resp = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    mpResponse = await resp.json();
    if (!resp.ok) {
      console.error('Erro Mercado Pago (preference):', mpResponse);
      return json(502, { error: friendlyMpError(mpResponse) });
    }
    console.log('mp-checkout: preference criada com sucesso — id =', mpResponse.id);
  } catch (err) {
    console.error('Falha ao chamar Mercado Pago:', err);
    return json(502, { error: 'Não foi possível falar com o Mercado Pago agora. Tente novamente.' });
  }

  const isTestMode = accessToken.startsWith('TEST-');
  const checkoutUrl = isTestMode
    ? (mpResponse.sandbox_init_point || mpResponse.init_point)
    : (mpResponse.init_point || mpResponse.sandbox_init_point);

  // Guarda o registro que o webhook vai buscar quando o pagamento for
  // notificado. "credited: false" é o que impede creditar duas vezes.
  await mpCheckoutsStore().setJSON(purchaseId, {
    email: user.email,
    package: packageKey,
    coins: pack.coins,
    preferenceId: mpResponse.id,
    credited: false,
    createdAt: new Date().toISOString(),
  });

  console.log('mp-checkout: registro salvo em mpCheckoutsStore —', purchaseId);

  return json(200, {
    ok: true,
    checkoutUrl,
    purchaseId,
  });
};
