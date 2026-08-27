// functions/.netlify/functions/[[route]].js
//
// Cópia de functions/api/[[route]].js que atende diretamente em
// /.netlify/functions/* — criada porque o _redirects (que reescreveria
// esse caminho para /api/:splat) não estava sendo aplicado. Isso evita
// depender do _redirects: o front-end continua chamando
// /.netlify/functions/auth-login etc. sem nenhuma mudança, e essa
// function responde direto, sem reescrita nenhuma.
//
// Este arquivo é o único "cola" novo do projeto. Ele:
//   1. Popula um `process.env` e `Buffer` globais (nodejs_compat cobre
//      Buffer/crypto, mas process.env por request precisamos setar nós
//      mesmos a partir do `env` do Worker).
//   2. Inicializa o shim de KV que substitui @netlify/blobs.
//   3. Traduz a Request do Worker pro objeto `event` que as functions
//      (exports.handler = async (event) => {...}) já esperam.
//   4. Roda a function e traduz o retorno {statusCode, headers, body}
//      de volta pra uma Response de verdade — inclusive múltiplos
//      Set-Cookie, que a Netlify representa em multiValueHeaders.

// require() em vez de import nomeado: o shim usa module.exports (CommonJS,
// igual aos 17 handlers), então ficamos consistentes e evitamos qualquer
// pegadinha de interop CJS/ESM no bundling do esbuild.
const { __setKV } = require('../../../netlify/functions/_lib/netlify-blobs-shim.js');

// Mapa nome-de-rota -> function original. Usar require() (CommonJS) aqui
// é proposital: assim os 17 arquivos de function continuam exatamente
// como estavam (exports.handler = ...), sem precisar reescrever nenhum
// deles para ESM. O bundler do Pages (esbuild) resolve o require() em
// build time sem problema.
const HANDLERS = {
  'auth-signup': () => require('../../../netlify/functions/auth-signup.js'),
  'auth-login': () => require('../../../netlify/functions/auth-login.js'),
  'auth-logout': () => require('../../../netlify/functions/auth-logout.js'),
  'auth-me': () => require('../../../netlify/functions/auth-me.js'),
  'auth-update': () => require('../../../netlify/functions/auth-update.js'),
  'auth-forgot-password': () => require('../../../netlify/functions/auth-forgot-password.js'),
  'auth-reset-password': () => require('../../../netlify/functions/auth-reset-password.js'),
  'auth-2fa-toggle': () => require('../../../netlify/functions/auth-2fa-toggle.js'),
  'auth-2fa-verify': () => require('../../../netlify/functions/auth-2fa-verify.js'),
  'onboarding-claim': () => require('../../../netlify/functions/onboarding-claim.js'),
  'favorites-toggle': () => require('../../../netlify/functions/favorites-toggle.js'),
  'projects-create': () => require('../../../netlify/functions/projects-create.js'),
  'projects-update': () => require('../../../netlify/functions/projects-update.js'),
  'projects-delete': () => require('../../../netlify/functions/projects-delete.js'),
  'portfolio-submit': () => require('../../../netlify/functions/portfolio-submit.js'),
  'portfolio-list': () => require('../../../netlify/functions/portfolio-list.js'),
  'portfolio-revoke': () => require('../../../netlify/functions/portfolio-revoke.js'),
  'mp-checkout': () => require('../../../netlify/functions/mp-checkout.js'),
  'mp-subscribe': () => require('../../../netlify/functions/mp-subscribe.js'),
  'mp-cancel': () => require('../../../netlify/functions/mp-cancel.js'),
  'mp-webhook': () => require('../../../netlify/functions/mp-webhook.js'),
  'stripe-subscribe': () => require('../../../netlify/functions/stripe-subscribe.js'),
  'stripe-cancel': () => require('../../../netlify/functions/stripe-cancel.js'),
  'stripe-webhook': () => require('../../../netlify/functions/stripe-webhook.js'),
  'track': () => require('../../../netlify/functions/track.js'),
  'chat': () => require('../../../netlify/functions/chat.js'),
};

function headersToObject(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key] = value;
  }
  return out;
}

async function buildEvent(request, url) {
  const queryStringParameters = {};
  const multiValueQueryStringParameters = {};
  url.searchParams.forEach((value, key) => {
    queryStringParameters[key] = value;
    if (!multiValueQueryStringParameters[key]) multiValueQueryStringParameters[key] = [];
    multiValueQueryStringParameters[key].push(value);
  });

  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text();
  }

  return {
    httpMethod: request.method,
    path: url.pathname,
    rawUrl: request.url,
    headers: headersToObject(request.headers),
    queryStringParameters,
    multiValueQueryStringParameters,
    body,
    isBase64Encoded: false,
  };
}

function buildResponse(result) {
  if (!result || typeof result.statusCode !== 'number') {
    return new Response('Erro interno: function não retornou um resultado válido.', {
      status: 500,
    });
  }

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (key.toLowerCase() === 'set-cookie') continue;
    responseHeaders.set(key, value);
  }

  const cookies = [];
  if (result.multiValueHeaders && result.multiValueHeaders['Set-Cookie']) {
    cookies.push(...result.multiValueHeaders['Set-Cookie']);
  } else if (result.headers && result.headers['Set-Cookie']) {
    cookies.push(result.headers['Set-Cookie']);
  }
  for (const cookie of cookies) {
    responseHeaders.append('Set-Cookie', cookie);
  }

  return new Response(result.body ?? '', {
    status: result.statusCode,
    headers: responseHeaders,
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  globalThis.process = globalThis.process || {};
  globalThis.process.env = env;

  __setKV(env.TF_KV);

  const routeParts = Array.isArray(params.route) ? params.route : [params.route];
  const routeName = routeParts.filter(Boolean).join('/');

  const loadHandler = HANDLERS[routeName];
  if (!loadHandler) {
    return new Response(JSON.stringify({ error: `Rota desconhecida: ${routeName}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const event = await buildEvent(request, url);

  try {
    const mod = loadHandler();
    const result = await mod.handler(event, {});
    return buildResponse(result);
  } catch (err) {
    console.error(`Erro na function "${routeName}":`, err);
    return new Response(JSON.stringify({ error: 'Erro interno do servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
