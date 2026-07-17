// netlify/functions/auth-me.js
//
// GET /.netlify/functions/auth-me — devolve o usuário logado (via cookie
// de sessão) ou { user: null }. Usado pelo front-end pra saber se mostra
// "Entrar" ou "Minha conta" no header, e pra proteger páginas como
// checkout.html.

const { getRawSessionUser, usersStore, touchDailyVisit, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const raw = await getRawSessionUser(event);
  if (!raw) return json(200, { user: null });

  // A sessão dura 30 dias — sem isso, a sequência só seria atualizada em
  // logins explícitos. Aqui contamos visitas ao painel como "check-in".
  const { changed } = touchDailyVisit(raw.user);
  if (changed) {
    await usersStore().setJSON(raw.user.email, raw.user);
  }

  const { passwordHash, ...safeUser } = raw.user;
  return json(200, { user: safeUser });
};
