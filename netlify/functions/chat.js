// netlify/functions/chat.js
//
// Função serverless que faz a ponte entre o site e a API da Anthropic.
// A chave da API fica guardada como variável de ambiente no Netlify —
// nunca é exposta no navegador do usuário.

const SYSTEM_PROMPT = `Você é a IA orquestradora da TremForge, uma plataforma que transforma ideias em software completo através de agentes especializados de IA (Architect AI, Designer AI, Developer AI, Database AI, QA AI, Deploy AI).

Seu papel nesta conversa é atuar como o ponto de entrada: conversar com o usuário para entender a ideia dele, fazer perguntas relevantes sobre o projeto (tipo de software, funcionalidades, público-alvo, plataforma), e esboçar um plano claro de como a "viagem" do projeto aconteceria — da ideia ao produto pronto.

Tom de voz: confiante, preciso, acolhedor, levemente inspirado na metáfora ferroviária (embarcar, trilhos, estações, chegar ao destino) mas sem exagerar — use a metáfora com moderação, não em toda frase.

Responda sempre em português do Brasil. Seja específico e prático, evite generalidades vagas. Quando fizer sentido, estruture a resposta com um plano de próximos passos.`;

const MAX_HISTORY_MESSAGES = 20; // limite de segurança para não deixar o payload/custo crescer sem controle
const MAX_MESSAGE_CHARS = 4000;

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Chave da API não configurada no servidor." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const incomingMessages = Array.isArray(payload.messages) ? payload.messages : [];
  if (incomingMessages.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Nenhuma mensagem enviada" }) };
  }

  // Sanitização básica: mantém só role/content válidos, corta histórico e tamanho
  const cleanMessages = incomingMessages
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  if (cleanMessages.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Mensagens inválidas" }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: cleanMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data?.error?.message || "Erro ao consultar a IA" }),
      };
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: text }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Falha ao conectar com a IA. Tente novamente." }),
    };
  }
};
