// netlify/functions/portfolio-revoke.js
//
// Marca um registro como revogado (revoked: true + revoked_date).
// PROTEGIDA por senha, mesmo esquema do portfolio-list.js
//
// POST body esperado: { "id": "proj_2026_07_16_abc123" }

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const password = event.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha inválida' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  if (!data.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Campo obrigatório: id' }) };
  }

  try {
    const store = getStore('portfolio-authorizations');
    const record = await store.get(data.id, { type: 'json' });

    if (!record) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Registro não encontrado' }) };
    }

    record.revoked = true;
    record.revoked_date = new Date().toISOString();

    await store.setJSON(data.id, record);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, record }),
    };
  } catch (err) {
    console.error('Erro revogando no Blobs:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao revogar autorização' }) };
  }
};
