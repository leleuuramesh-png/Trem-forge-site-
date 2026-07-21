// netlify/functions/mp-webhook.js
//
// POST /.netlify/functions/mp-webhook
//
// Endpoint público que o Mercado Pago chama sempre que algo muda numa
// assinatura (autorizada, pausada, cancelada) ou num pagamento. Precisa
// ser cadastrado no painel do Mercado Pago (Suas integrações > Webhooks)
// — é lá que se gera o MP_WEBHOOK_SECRET usado pra validar a assinatura.
//
// Fluxo:
//   1. Valida o header x-signature com HMAC SHA256 (evita notificação forjada).
//   2. Busca o recurso completo na API do Mercado Pago (nunca confia só
//      no payload recebido — o payload é só um aviso "algo mudou, vem ver").
//   3. Acha o usuário dono da assinatura e atualiza plan/planStatus.
//
// Sempre responde 200 depois de processar (mesmo em casos que a gente
// decide ignorar), pra o Mercado Pago não ficar re-tentando. Só devolve
// 401 quando a assinatura do webhook não bate — nesse caso É correto
// deixar o Mercado Pago tentar de novo, mas na prática 401 indica payload
// forjado ou secret errado.

const crypto = require('crypto');
const {
  usersStore,
  userIndexStore,
  mpPreapprovalsStore,
  addActivity,
  json,
  PLAN_CONFIG,
} = require('./_lib/auth');

const MP_API = 'https://api.mercadopago.com';

const STATUS_MAP = {
  authorized: 'active',
  pending: 'pending',
  paused: 'paused',
  cancelled: 'canceled',
};

function getHeader(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null;
}

function verifySignature(event, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;

  const signatureHeader = getHeader(event, 'x-signature');
  const requestId = getHeader(event, 'x-request-id');
  if (!signatureHeader || !requestId || !dataId) return false;

  const parts = {};
  signatureHeader.split(',').forEach((chunk) => {
    const [k, v] = chunk.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  });
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const template = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(template).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('mp-webhook: MP_ACCESS_TOKEN não configurado — notificação ignorada.');
    return json(200, { ok: true }); // evita retry infinito enquanto não configurar
  }

  console.log('mp-webhook: notificação recebida.');

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    body = {};
  }

  const query = event.queryStringParameters || {};
  const dataId = String((body.data && body.data.id) || query['data.id'] || query.id || '').trim();
  const topic = String(body.type || body.topic || query.type || query.topic || '').trim();

  console.log('mp-webhook: dataId =', dataId, '| topic =', topic);

  if (!dataId) {
    console.warn('mp-webhook: notificação sem data.id — ignorada.');
    return json(200, { ok: true }); // notificação sem id útil, nada a fazer
  }

  if (!verifySignature(event, dataId)) {
    console.error('mp-webhook: assinatura inválida, notificação descartada.');
    return json(401, { error: 'Assinatura inválida.' });
  }

  console.log('mp-webhook: assinatura HMAC validada com sucesso.');

  // Por enquanto só tratamos notificações de assinatura (preapproval).
  // Notificações de "payment" (pagamentos avulsos) entram quando
  // mp-checkout.js existir.
  if (topic !== 'subscription_preapproval' && topic !== 'preapproval') {
    console.log('mp-webhook: topic', topic, 'não tratado ainda — ignorado.');
    return json(200, { ok: true });
  }

  let preapproval;
  try {
    const resp = await fetch(`${MP_API}/preapproval/${dataId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    preapproval = await resp.json();
    if (!resp.ok) {
      console.error('mp-webhook: falha ao buscar preapproval na API do MP:', preapproval);
      return json(200, { ok: true });
    }
  } catch (err) {
    console.error('mp-webhook: erro de rede buscando preapproval:', err);
    return json(200, { ok: true });
  }

  console.log(
    'mp-webhook: preapproval encontrada — status =', preapproval.status,
    '| external_reference =', preapproval.external_reference,
    '| date_created =', preapproval.date_created
  );

  // Descobre quem é o dono: primeiro pelo índice salvo em mp-subscribe.js,
  // com fallback pro external_reference (id do usuário) + índice de ids.
  let email = null;
  let planKey = null;
  const stored = await mpPreapprovalsStore().get(dataId, { type: 'json' });
  if (stored) {
    email = stored.email;
    planKey = stored.plan;
    console.log('mp-webhook: dono encontrado via índice mpPreapprovalsStore —', email, '| plano =', planKey);
  } else if (preapproval.external_reference) {
    email = await userIndexStore().get(preapproval.external_reference, { type: 'text' });
    const amount = preapproval.auto_recurring && preapproval.auto_recurring.transaction_amount;
    planKey = Object.keys(PLAN_CONFIG).find((k) => PLAN_CONFIG[k].priceBRL === amount) || null;
    console.log('mp-webhook: dono encontrado via fallback external_reference —', email, '| plano =', planKey);
  }

  if (!email) {
    console.error('mp-webhook: não achei o usuário dono da assinatura', dataId);
    return json(200, { ok: true });
  }

  const user = await usersStore().get(email, { type: 'json' });
  if (!user) {
    console.error('mp-webhook: usuário', email, 'não encontrado no usersStore.');
    return json(200, { ok: true });
  }

  // Proteção contra notificação fora de ordem: se essa notificação é de uma
  // preapproval DIFERENTE da que o usuário tem hoje, e essa preapproval foi
  // criada antes da atual, é uma notificação atrasada de uma assinatura já
  // superada (ex: tentativa cancelada antes de uma segunda bem-sucedida).
  // Nesse caso, ignoramos — a preapproval mais nova é que deve mandar no status.
  const incomingCreatedAt = preapproval.date_created ? new Date(preapproval.date_created).getTime() : 0;
  const currentCreatedAt = user.mpPreapprovalCreatedAt || 0;
  const isSamePreapproval = user.mpPreapprovalId === dataId;

  if (!isSamePreapproval && user.mpPreapprovalId && incomingCreatedAt && incomingCreatedAt < currentCreatedAt) {
    console.warn(
      `mp-webhook: notificação da preapproval ${dataId} (criada ${preapproval.date_created}) ignorada — ` +
      `usuário ${email} já está em ${user.mpPreapprovalId} (criada em timestamp mais recente).`
    );
    return json(200, { ok: true });
  }

  const newStatus = STATUS_MAP[preapproval.status] || preapproval.status;
  const planLabel = (PLAN_CONFIG[planKey] && PLAN_CONFIG[planKey].label) || planKey || user.plan;
  const changed = user.planStatus !== newStatus;

  user.plan = planKey || user.plan;
  user.planStatus = newStatus;
  user.planProvider = 'mercadopago';
  user.planCurrency = 'BRL';
  user.mpPreapprovalId = dataId;
  user.mpPreapprovalCreatedAt = incomingCreatedAt || currentCreatedAt;

  if (changed) {
    const messages = {
      active: `Assinatura do plano ${planLabel} confirmada. 🎉`,
      paused: `Assinatura do plano ${planLabel} pausada.`,
      canceled: `Assinatura do plano ${planLabel} cancelada.`,
      pending: `Assinatura do plano ${planLabel} aguardando pagamento.`,
    };
    addActivity(user, 'plan', messages[newStatus] || `Status da assinatura atualizado: ${newStatus}.`);
  }

  await usersStore().setJSON(email, user);

  console.log(
    'mp-webhook: usuário', email, 'atualizado — planStatus =', newStatus,
    '| mudou de status?', changed
  );

  return json(200, { ok: true });
};
