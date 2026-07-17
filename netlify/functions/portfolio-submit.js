// netlify/functions/portfolio-submit.js
//
// Recebe o envio do formulário de orçamento (seção de autorização de portfólio)
// e salva um registro no Netlify Blobs.
//
// O FRONT-END deve enviar JSON (não FormData) pro endpoint:
//   POST /.netlify/functions/portfolio-submit
//   Content-Type: application/json
//
// Exemplo de body esperado (mesmos names do form):
// {
//   "clientName": "...", "projectName": "...", "email": "...",
//   "portfolio_permission": true,
//   "portfolio_visibility": "public" | "anonymous" | "after_delivery",
//   "show_company_name": true, "show_project_link": false,
//   "display_name": "...", "portfolio_message": "..."
// }
//
// Este endpoint é PÚBLICO de propósito (qualquer cliente que preenche o
// formulário de orçamento precisa conseguir chamar, sem senha).

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  if (!data.clientName || !data.projectName || !data.email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Campos obrigatórios faltando: clientName, projectName, email' }),
    };
  }

  const id = `proj_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_${Math.random().toString(36).slice(2, 8)}`;

  const record = {
    id,
    clientName: data.clientName,
    projectName: data.projectName,
    email: data.email,
    portfolio_permission: !!data.portfolio_permission,
    portfolio_visibility: data.portfolio_permission ? (data.portfolio_visibility || null) : null,
    show_company_name: !!data.show_company_name,
    show_project_link: !!data.show_project_link,
    display_name: data.display_name || null,
    portfolio_message: data.portfolio_message || null,
    authorization_date: new Date().toISOString(),
    revoked: false,
    revoked_date: null,
  };

  try {
    const store = getStore('portfolio-authorizations');
    await store.setJSON(id, record);
  } catch (err) {
    console.error('Erro salvando no Blobs:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao salvar autorização' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, id }),
  };
};
