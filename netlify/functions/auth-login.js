// netlify/functions/auth-login.js
//
// POST /.netlify/functions/auth-login
// Body JSON: { "email": "...", "password": "..." }

const {
  usersStore,
  normalizeEmail,
  verifyPassword,
  createSession,
  buildSessionCookie,
  json,
  touchDailyVisit,
  ensureEngagementFields,
  createTwoFactorCode,
  createPendingLogin,
} = require('./_lib/auth');

// Envia o código de verificação em duas etapas por e-mail via Resend.
// Mesmo provedor e mesmo padrão visual usado em auth-forgot-password.js,
// só que com o texto adaptado pra contexto de login.
async function sendTwoFactorEmail(email, name, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY não configurada nas variáveis de ambiente.');
  }

  const fromAddress = process.env.RESEND_FROM || 'Trem Forge <no-reply@tremforge.com>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [email],
      subject: `${code} é seu código de login — Trem Forge`,
      html: `
        <div style="font-family:Arial,sans-serif;background:#0D0704;color:#F3F4F6;padding:32px;border-radius:16px;max-width:420px;margin:0 auto;">
          <h2 style="color:#FF9556;margin:0 0 12px;">Confirme seu login</h2>
          <p style="color:#CBC0B4;font-size:14px;line-height:1.5;">
            Olá${name ? `, ${name}` : ''}. Use o código abaixo pra concluir o login no Trem Forge.
            Ele expira em 10 minutos.
          </p>
          <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#fff;background:rgba(255,90,31,.12);
            border:1px solid rgba(255,90,31,.35);border-radius:12px;padding:16px;text-align:center;margin:20px 0;">
            ${code}
          </p>
          <p style="color:#8C7C6E;font-size:12.5px;line-height:1.5;">
            Se não foi você tentando entrar, troque sua senha assim que possível.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar e-mail via Resend (${res.status}): ${errText}`);
  }
}

// Rate limiting simples por e-mail (evita força bruta) — em memória do
// processo da function. Não é robusto entre invocações frias, mas ajuda.
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyAttempts(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  record.count += 1;
  return record.count > MAX_ATTEMPTS;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'JSON inválido' });
  }

  const email = normalizeEmail(data.email);
  const password = String(data.password || '');

  if (!email || !password) {
    return json(400, { error: 'Informe e-mail e senha.' });
  }

  if (tooManyAttempts(email)) {
    return json(429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  }

  const store = usersStore();
  const user = await store.get(email, { type: 'json' });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(401, { error: 'E-mail ou senha incorretos.' });
  }

  ensureEngagementFields(user);

  // Usuário com 2FA ativado: a senha bateu, mas ainda não cria sessão.
  // Manda o código por e-mail e devolve um pendingToken pro front avançar
  // pra etapa de verificação (auth-2fa-verify.js finaliza o login).
  if (user.twoFactorEnabled) {
    try {
      const code = await createTwoFactorCode(email);
      await sendTwoFactorEmail(email, user.name, code);
      const pendingToken = await createPendingLogin(email);
      return json(200, { ok: true, requires2FA: true, pendingToken });
    } catch (err) {
      console.error('Erro enviando código 2FA:', err);
      return json(500, { error: 'Não foi possível enviar o código de verificação. Tente novamente.' });
    }
  }

  const { changed } = touchDailyVisit(user);
  if (changed) {
    await store.setJSON(email, user);
  }

  const { token, expiresAt } = await createSession(user);
  const { passwordHash, ...safeUser } = user;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildSessionCookie(token, Math.floor((expiresAt - Date.now()) / 1000)),
    },
    body: JSON.stringify({ ok: true, user: safeUser }),
  };
};
