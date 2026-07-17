// netlify/functions/auth-logout.js
//
// POST /.netlify/functions/auth-logout — encerra a sessão atual.

const { destroySession, clearSessionCookie, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  await destroySession(event);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
    body: JSON.stringify({ ok: true }),
  };
};
