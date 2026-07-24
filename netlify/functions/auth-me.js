// netlify/functions/auth-me.js
//
// GET /.netlify/functions/auth-me
//
// Usada pelo header do site (index-5.html, painel.html etc.) para saber,
// a cada carregamento de página, se existe uma sessão ativa — e assim
// trocar o link "Entrar" por "Painel".
//
// Sempre responde 200, mesmo sem sessão: { user: null }. O front trata
// a ausência de usuário como "não logado" (não é um erro).

const { getSessionUser, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const user = await getSessionUser(event);
    if (!user) {
      return json(200, { user: null });
    }

    // Não expõe o token de sessão pro front — ele já vive no cookie
    // HttpOnly, não precisa (e não deve) trafegar no corpo da resposta.
    const { sessionToken, ...safeUser } = user;

    return json(200, { user: safeUser });
  } catch (err) {
    // Falha ao ler Blobs, sessão corrompida, etc. — trata como "sem sessão"
    // em vez de estourar 500 e quebrar o carregamento da página.
    console.error('auth-me error:', err);
    return json(200, { user: null });
  }
};
