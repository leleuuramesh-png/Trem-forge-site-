// netlify/functions/track.js
//
// Tracking mínimo de cliques na galeria de templates (templates.html).
// Recebe { type, value, page } do navegador e apenas registra em log
// (console.log), sem banco de dados — sem custo, sem dependências.
//
// Como consultar os dados:
//   Netlify > seu site > Functions > track > Function log
//   (ou `netlify functions:log track` via CLI)
//   Cada linha de log começa com "TRACK " e é um JSON válido, então dá
//   pra copiar os logs e filtrar/contar com qualquer ferramenta de texto.
//
// Isso é propositalmente simples — é um contador de log, não analytics
// de verdade. Se o volume de cliques crescer e isso virar algo que você
// consulta com frequência, vale migrar para uma tabela (Supabase/Postgres)
// ou uma ferramenta de analytics dedicada (Plausible, PostHog etc.).

const ALLOWED_TYPES = ['filter_click', 'project_click'];
const MAX_FIELD_LENGTH = 120;

function truncate(str) {
  if (typeof str !== 'string') return '';
  return str.slice(0, MAX_FIELD_LENGTH);
}

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método não permitido.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }

  const type = ALLOWED_TYPES.includes(payload.type) ? payload.type : null;
  if (!type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type inválido.' }) };
  }

  const event_ = {
    type: type,
    value: truncate(payload.value),
    page: truncate(payload.page),
    ts: new Date().toISOString(),
  };

  // Fica visível em Netlify > Functions > track > Function log
  console.log('TRACK ' + JSON.stringify(event_));

  return { statusCode: 204, headers, body: '' };
};
