// netlify/functions/portfolio-list.js
//
// Devolve todos os registros de autorização de portfólio.
// PROTEGIDA por senha: espera o header  x-admin-password
// A senha correta fica configurada como variável de ambiente
// no Netlify: Site settings -> Environment variables -> ADMIN_PASSWORD

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const password = event.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha inválida' }) };
  }

  try {
    const store = getStore('portfolio-authorizations');
    const { blobs } = await store.list();

    const records = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: 'json' }))
    );

    // Mais recentes primeiro
    records.sort((a, b) => new Date(b.authorization_date) - new Date(a.authorization_date));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    };
  } catch (err) {
    console.error('Erro listando Blobs:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao carregar autorizações' }) };
  }
};
