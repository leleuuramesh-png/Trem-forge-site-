// netlify/functions/mp-cancel.js
//
// POST /.netlify/functions/mp-cancel
//
// Cancela a assinatura recorrente (Preapproval) do usuário logado no
// Mercado Pago. Atualizamos o registro local de forma otimista pra
// refletir na hora no painel — a confirmação definitiva ainda chega
// depois via webhook (mp-webhook.js), que é idempotente nesse caso
// (mesma preapprovalId, só reafirma o status "canceled").

const {
  usersStore,
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
  if (!accessToken) {
    return json(500, { error: 'Mercado Pago ainda não configurado (falta MP_ACCESS_TOKEN no ambiente).' });
  }

  const raw = await getRawSessionUser(event);
  if (!raw) return json(401, { error: 'Não autenticado.' });

  const user = raw.user;

  if (!user.mpPreapprovalId) {
    return json(400, { error: 'Você não tem nenhuma assinatura pra cancelar.' });
  }

  if (user.planStatus === 'canceled') {
    const { passwordHash, ...safeUser } = user;
    return json(200, { ok: true, alreadyCanceled: true, user: safeUser });
  }

  let mpResponse;
  try {
    const resp = await fetch(`${MP_API}/preapproval/${user.mpPreapprovalId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    mpResponse = await resp.json();
    if (!resp.ok) {
      console.error('Erro Mercado Pago (cancelamento):', mpResponse);
      return json(502, { error: 'Não foi possível cancelar a assinatura agora. Tente novamente ou fale com o suporte.' });
    }
  } catch (err) {
    console.error('Falha ao chamar Mercado Pago (cancelamento):', err);
    return json(502, { error: 'Não foi possível falar com o Mercado Pago agora. Tente novamente.' });
  }

  const planLabel = (PLAN_CONFIG[user.plan] && PLAN_CONFIG[user.plan].label) || user.plan;
  user.planStatus = 'canceled';
  addActivity(user, 'plan', `Assinatura do plano ${planLabel} cancelada.`);

  await usersStore().setJSON(user.email, user);

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
