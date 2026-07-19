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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  console.log('[mp-subscribe] DEBUG token prefix:', accessToken ? accessToken.slice(0, 8) : 'UNDEFINED');
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
      return json(502, { error: mpResponse.message || 'Mercado Pago recusou a criação da assinatura.' });
    }
  } catch (err) {
    console.error('Falha ao chamar Mercado Pago:', err);
    return json(502, { error: 'Não foi possível falar com o Mercado Pago agora. Tente novamente.' });
  }

  const preapprovalId = mpResponse.id;
  // Se o access token for de teste (começa com "TEST-"), o Mercado Pago
  // ainda devolve os dois links (init_point e sandbox_init_point), mas
  // precisamos priorizar o de sandbox — senão o pagador cai no checkout
  // de produção e cartões de teste são recusados.
  const isTestMode = accessToken.startsWith('TEST-');
  let checkoutUrl = isTestMode
    ? (mpResponse.sandbox_init_point || mpResponse.init_point)
    : (mpResponse.init_point || mpResponse.sandbox_init_point);

  // Quando o preapproval é criado sem preapproval_plan_id associado, o MP
  // não devolve sandbox_init_point mesmo em modo teste — força o domínio
  // sandbox manualmente nesse caso, senão o pagador cai no checkout de
  // produção com um cartão de teste.
  if (isTestMode && !mpResponse.sandbox_init_point && checkoutUrl) {
    checkoutUrl = checkoutUrl.replace(
      /^https:\/\/(www\.)?mercadopago\.com/,
      'https://sandbox.mercadopago.com'
    );
  }

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
    // DEBUG TEMPORÁRIO — remover depois de confirmar o ambiente correto.
    _debug: {
      tokenPrefix: accessToken.slice(0, 6),
      isTestMode,
      hasInitPoint: !!mpResponse.init_point,
      hasSandboxInitPoint: !!mpResponse.sandbox_init_point,
    },
  });
};
