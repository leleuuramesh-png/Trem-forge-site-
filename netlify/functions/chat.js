// netlify/functions/chat.js
//
// Backend for the "Testar IA" chat widget on index-2.html.
// Receives { messages: [{ role, content }, ...] } from the browser and
// returns { reply: "..." } using the Anthropic API.
//
// Required environment variable (set in Netlify > Site settings > Environment variables):
//   ANTHROPIC_API_KEY = sk-ant-...
//
// Optional:
//   ANTHROPIC_MODEL   = claude-sonnet-4-6 (default if not set)

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_MESSAGES = 20; // cap history sent to the API
const MAX_MESSAGE_LENGTH = 4000; // characters per message

const SYSTEM_PROMPT = `Você é o assistente de IA da Trem Forge, uma plataforma que transforma ideias
descritas em linguagem natural em software pronto — sites, apps e sistemas — construído por
agentes de IA, do zero ao deploy.

Seu papel nesta conversa (widget "Testar IA" no site):
- Entender rapidamente o que a pessoa quer construir (tipo de projeto, funcionalidades, público).
- Fazer perguntas objetivas quando faltar informação essencial.
- Explicar de forma simples como a Trem Forge poderia construir o que foi descrito.
- Ser direto, animado e usar o tom da marca (trilhos/viagem), sem exagerar.
- Responder sempre em português do Brasil.
- Nunca inventar preços ou prazos exatos — para isso, direcionar ao formulário "Enviar Projeto".

Mantenha as respostas curtas (2 a 5 frases), adequadas para um widget de chat.`;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY não configurada nas variáveis de ambiente da Netlify.');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'IA temporariamente indisponível. Tente novamente em instantes.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'JSON inválido no corpo da requisição.' }),
    };
  }

  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  if (incoming.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Envie ao menos uma mensagem.' }),
    };
  }

  // Sanitize: keep only role/content, valid roles, trim length, cap history size.
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_MESSAGE_LENGTH),
    }));

  if (messages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Nenhuma mensagem válida foi enviada.' }),
    };
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Erro da API Anthropic:', data);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Não foi possível falar com a IA agora. Tente novamente.' }),
      };
    }

    const reply = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: reply || 'Desculpe, não consegui gerar uma resposta agora.' }),
    };
  } catch (err) {
    console.error('Falha ao chamar a API Anthropic:', err);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Erro de conexão com a IA. Tente novamente.' }),
    };
  }
};
