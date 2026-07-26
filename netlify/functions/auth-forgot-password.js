// netlify/functions/auth-forgot-password.js
//
// POST /.netlify/functions/auth-forgot-password
// Body JSON: { "email": "..." }
//
// Gera um código de 6 dígitos, guarda o hash no store password_resets
// (15 min de validade) e envia por e-mail via Resend.
//
// Importante: SEMPRE responde 200 com a mesma mensagem genérica, exista
// ou não o e-mail na base — evita que alguém use este endpoint pra
// descobrir quais e-mails têm conta no Trem Forge (enumeration attack).

const {
  usersStore,
  normalizeEmail,
  isValidEmail,
  createPasswordReset,
  json,
} = require('./_lib/auth');

// Envia o código de redefinição por SMS via Comtele. Mesmo padrão de erro
// do sendResetEmail: lança se faltar config ou se a API responder erro.
async function sendResetSMS(phone, code) {
  const apiKey = process.env.COMTELE_API_KEY;
  if (!apiKey) {
    throw new Error('COMTELE_API_KEY não configurada nas variáveis de ambiente.');
  }

  // A Comtele espera o número como STRING, sem o "+" (só DDI+DDD+número).
  const receiver = String(phone).replace(/\D/g, '');

  const res = await fetch('https://api.comtele.com.br/messages/sms/send', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receivers: [receiver],
      contactGroups: [],
      message: `Trem Forge: seu codigo de redefinicao de senha e ${code}. Valido por 15 minutos.`,
      route: process.env.COMTELE_ROUTE || '17', // rota "Premium" — prioridade de entrega pro código de reset
      tag: 'password-reset',
      custom: 'password-reset',
    }),
  });

  const result = await res.json().catch(() => null);

  if (!res.ok || (result && result.hasError)) {
    const detail = result ? JSON.stringify(result) : await res.text().catch(() => '');
    throw new Error(`Falha ao enviar SMS via Comtele (${res.status}): ${detail}`);
  }
}

// Mesmo padrão de rate limit em memória usado em auth-login.js.
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

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

// Mensagem propositalmente ambígua sobre o canal usado (e-mail ou SMS):
// confirmar o canal também vazaria informação sobre a conta (ex: "esse
// e-mail não tem telefone cadastrado" revelaria que a conta existe).
const GENERIC_OK = {
  ok: true,
  message: 'Se este e-mail tiver uma conta, enviamos um código de confirmação por e-mail ou SMS, conforme disponível.',
};

async function sendResetEmail(email, name, code) {
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
      subject: `${code} é seu código de redefinição de senha — Trem Forge`,
      html: `
        <div style="font-family:Arial,sans-serif;background:#0D0704;color:#F3F4F6;padding:32px;border-radius:16px;max-width:420px;margin:0 auto;">
          <h2 style="color:#FF9556;margin:0 0 12px;">Redefinir senha</h2>
          <p style="color:#CBC0B4;font-size:14px;line-height:1.5;">
            Olá${name ? `, ${name}` : ''}. Use o código abaixo pra redefinir sua senha no Trem Forge.
            Ele expira em 15 minutos.
          </p>
          <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#fff;background:rgba(255,90,31,.12);
            border:1px solid rgba(255,90,31,.35);border-radius:12px;padding:16px;text-align:center;margin:20px 0;">
            ${code}
          </p>
          <p style="color:#8C7C6E;font-size:12.5px;line-height:1.5;">
            Se você não pediu essa redefinição, pode ignorar este e-mail com segurança.
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

  if (!email || !isValidEmail(email)) {
    return json(400, { error: 'Informe um e-mail válido.' });
  }

  if (tooManyAttempts(email)) {
    // Ainda genérico, mas com status diferente pra o front conseguir
    // avisar "espera um pouco" sem confirmar se o e-mail existe.
    return json(429, { error: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' });
  }

  try {
    const user = await usersStore().get(email, { type: 'json' });

    // Não existe conta com esse e-mail: responde OK genérico mesmo assim.
    if (!user) {
      return json(200, GENERIC_OK);
    }

    const wantsSMS = data.channel === 'sms';
    const code = await createPasswordReset(email);

    // SMS só é usado se o usuário tiver telefone cadastrado; caso
    // contrário caímos pro e-mail de forma silenciosa (a resposta segue
    // genérica, então isso não vaza se o telefone existe ou não).
    if (wantsSMS && user.phone) {
      await sendResetSMS(user.phone, code);
    } else {
      await sendResetEmail(email, user.name, code);
    }

    return json(200, GENERIC_OK);
  } catch (err) {
    console.error('auth-forgot-password error:', err);
    return json(500, { error: 'Não foi possível processar sua solicitação. Tente novamente em instantes.' });
  }
};
