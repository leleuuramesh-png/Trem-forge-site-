// netlify/functions/mp-subscribe.js
//
// POST /.netlify/functions/mp-subscribe
// Body JSON: { "plan": "pro" | "business" }
//
// Cria uma assinatura recorrente (Preapproval) no Mercado Pago pro
// usuário logado e devolve a URL de checkout (init_point) pra ele
// entrar com o cartão e autorizar a cobrança mensal automática.
//
// A assinatura fica "pending" até o Mercado Pago confirmar via webhook
// (mp-webhook.js) que o pagador autorizou — é lá que o status vira
// "active" de verdade. Documentação: POST /preapproval (assinatura sem
// plano associado, com pagamento pendente).

const {
  usersStore,
  userIndexStore,
  mpPreapprovalsStore,
  getRawSessionUser,
  addActivity,
  json,
  PLAN_CONFIG,
} = require('./_lib/auth');

const MP_API = 'https://api.mercadopago.com';

// Traduz os erros mais comuns que o Mercado Pago devolve ao criar um
// preapproval pra uma mensagem que faz sentido pro usuário final. O texto
// técnico original sempre vai pro console.error — isso aqui é só pra tela.
function friendlyMpError(mpResponse) {
  const rawMessage = String((mpResponse && mpResponse.message) || '').toLowerCase();
  const causes = (mpResponse && Array.isArray(mpResponse.cause)) ? mpResponse.cause : [];
  const causeText = causes.map((c) => String(c.description || c.code || '')).join(' | ').toLowerCase();
  const haystack = `${rawMessage} ${causeText}`;

  if (haystack.includes('real or test users') || haystack.includes('same environment')) {
    return 'Não foi possível iniciar a assinatura: há uma incompatibilidade entre conta de teste e conta real do Mercado Pago. Fale com o suporte.';
  }
  if (haystack.includes("can't pay yourself") || haystack.includes('cannot be the same') || haystack.includes('collector')) {
    return 'Não é possível assinar usando o mesmo e-mail cadastrado como recebedor no Mercado Pago. Use outro e-mail de pagamento.';
  }
  if (haystack.includes('invalid') && haystack.includes('email')) {
    return 'O e-mail cadastrado na sua conta não é válido para o Mercado Pago. Verifique seu e-mail no seu perfil.';
  }
  if (haystack.includes('transaction_amount') || haystack.includes('auto_recurring')) {
    return 'Não foi possível configurar o valor da assinatura. Tente novamente em instantes ou fale com o suporte.';
  }
  if (haystack.includes('payer_email')) {
    return 'Houve um problema com o e-mail usado para pagamento. Verifique seu e-mail no seu perfil e tente novamente.';
  }

  return 'Não foi possível iniciar sua assinatura no Mercado Pago agora. Tente novamente em instantes ou fale com o suporte.';
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

  const planKey = String(data.plan || '').trim();
  const plan = PLAN_CONFIG[planKey];
  if (!plan) {
    return json(400, { error: 'Plano inválido. Use "pro" ou "business".' });
  }

  const user = raw.user;
  const siteUrl = (process.env.SITE_URL || `https://${event.headers.host}`).replace(/\/$/, '');

  const payload = {
    reason: `Trem Forge — Plano ${plan.label}`,
    external_reference: user.id,
    payer_email: user.email,
    back_url: `${siteUrl}/painel.html?assinatura=ok`,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: plan.priceBRL,
      currency_id: 'BRL',
    },
  };

  let mpResponse;
  try {
    const resp = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    mpResponse = await resp.json();
    if (!resp.ok) {
      console.error('Erro Mercado Pago (preapproval):', mpResponse);
      return json(502, { error: friendlyMpError(mpResponse) });
    }
  } catch (err) {
    console.error('Falha ao chamar Mercado Pago:', err);
    return json(502, { error: 'Não foi possível falar com o Mercado Pago agora. Tente novamente.' });
  }

  const preapprovalId = mpResponse.id;
  const isTestMode = accessToken.startsWith('TEST-');
  const checkoutUrl = isTestMode
    ? (mpResponse.sandbox_init_point || mpResponse.init_point)
    : (mpResponse.init_point || mpResponse.sandbox_init_point);

  // Guarda os dois índices que o webhook vai precisar: preapproval -> quem
  // é o usuário e qual plano, e id do usuário -> email (fallback).
  await mpPreapprovalsStore().setJSON(String(preapprovalId), {
    email: user.email,
    plan: planKey,
    createdAt: new Date().toISOString(),
  });
  await userIndexStore().set(user.id, user.email);

  user.plan = planKey;
  user.planStatus = 'pending';
  user.planProvider = 'mercadopago';
  user.planCurrency = 'BRL';
  user.mpPreapprovalId = String(preapprovalId);
  addActivity(user, 'plan', `Assinatura do plano ${plan.label} iniciada — aguardando confirmação do pagamento.`);

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, {
    ok: true,
    checkoutUrl,
    user: safeUser,
  });
};
