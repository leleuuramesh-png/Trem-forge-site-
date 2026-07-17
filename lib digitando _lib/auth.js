// netlify/functions/_lib/auth.js
//
// Helpers de autenticação compartilhados entre as functions de auth,
// assinatura (Mercado Pago / Stripe) e checkout (coins).
//
// Armazenamento: Netlify Blobs (sem banco de dados externo).
//   store "users"    -> chave = email em minúsculas   -> { id, email, passwordHash, ... }
//   store "sessions" -> chave = token da sessão        -> { userId, email, expiresAt }
//
// Senhas: hash com scrypt (nativo do Node, sem dependência extra).

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const SESSION_COOKIE = 'tf_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function usersStore() {
  return getStore('users');
}

function sessionsStore() {
  return getStore('sessions');
}

function referralsStore() {
  return getStore('referrals');
}

// user.id -> email. Preenchido sob demanda (lazy) sempre que o usuário
// entra em algum fluxo de pagamento, já que a maioria das contas nunca
// precisará ser encontrada pelo id (só o webhook do gateway usa isso).
function userIndexStore() {
  return getStore('user_index');
}

// preapproval_id (Mercado Pago) -> { email, plan }. Criado no momento da
// assinatura (mp-subscribe.js) pra o webhook (mp-webhook.js) conseguir
// achar o usuário certo sem depender só do external_reference.
function mpPreapprovalsStore() {
  return getStore('mp_preapprovals');
}

// Planos pagos recorrentes (assinatura). Os valores em BRL espelham a
// seção #planos do index-2.html — mudou lá, muda aqui também.
const PLAN_CONFIG = {
  pro: { label: 'Pro', priceBRL: 49 },
  business: { label: 'Business', priceBRL: 199 },
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ---------------------------------------------------------------------
// Engajamento: streak de visitas, insígnias, histórico de atividade e
// indicação de amigos. Tudo guardado dentro do próprio registro do
// usuário (Netlify Blobs), sem serviço externo.
// ---------------------------------------------------------------------

const BADGES = {
  boas_vindas: { name: 'Boas-vindas', icon: '👋', desc: 'Criou a conta no Trem Forge.' },
  streak_3: { name: 'Sequência de 3 dias', icon: '🔥', desc: 'Voltou 3 dias seguidos.' },
  streak_7: { name: 'Sequência de 7 dias', icon: '🚀', desc: 'Voltou 7 dias seguidos.' },
  streak_30: { name: 'Sequência de 30 dias', icon: '🏆', desc: 'Voltou 30 dias seguidos.' },
  indicou_amigo: { name: 'Indicou um amigo', icon: '🤝', desc: 'Trouxe alguém pro Trem Forge.' },
  primeiro_projeto: { name: 'Primeiro projeto', icon: '🧩', desc: 'Cadastrou o primeiro projeto na conta.' },
};

// Sistema de projetos: cada usuário mantém sua própria lista de projetos
// dentro do próprio registro (Netlify Blobs), no mesmo padrão de
// badges/activity/favorites. Sem IA gerando código de verdade — é só o
// CRUD de acompanhamento (nome, status, link, descrição).
const PROJECT_STATUSES = {
  ideia: { label: 'Ideia', color: '#8C7C6E' },
  em_andamento: { label: 'Em andamento', color: '#FF9556' },
  pausado: { label: 'Pausado', color: '#F87171' },
  concluido: { label: 'Concluído', color: '#34D399' },
};
const MAX_PROJECTS_PER_USER = 60;

function generateProjectId() {
  return 'proj_' + crypto.randomBytes(8).toString('hex');
}

function generateReferralCode(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()
    + Math.random().toString(36).slice(2, 4).toUpperCase();
}

// Garante que campos novos existam mesmo em usuários criados antes desta
// feature (evita `undefined` quebrando o front).
function ensureEngagementFields(user) {
  if (!Array.isArray(user.badges)) user.badges = [];
  if (!Array.isArray(user.activity)) user.activity = [];
  if (!Array.isArray(user.favorites)) user.favorites = [];
  if (!Array.isArray(user.projects)) user.projects = [];
  if (!('plan' in user)) user.plan = null;                 // 'pro' | 'business' | null
  if (!('planStatus' in user)) user.planStatus = null;      // 'pending' | 'active' | 'paused' | 'canceled' | null
  if (!('planProvider' in user)) user.planProvider = null;  // 'mercadopago' | 'stripe' | null
  if (!('planCurrency' in user)) user.planCurrency = null;  // 'BRL' | 'USD' | null
  if (!('mpPreapprovalId' in user)) user.mpPreapprovalId = null;
  if (typeof user.streak !== 'number') user.streak = 0;
  if (!user.lastVisit) user.lastVisit = null;
  if (!user.referralCode) user.referralCode = generateReferralCode(user.id || user.email);
  if (typeof user.referralCount !== 'number') user.referralCount = 0;
  if (typeof user.coinsBalance !== 'number') user.coinsBalance = 0;
  return user;
}

function addActivity(user, type, message) {
  user.activity.unshift({ type, message, at: new Date().toISOString() });
  if (user.activity.length > 30) user.activity.length = 30;
}

function awardBadge(user, badgeId) {
  const def = BADGES[badgeId];
  if (!def) return false;
  if (user.badges.some((b) => b.id === badgeId)) return false;
  user.badges.push({ id: badgeId, name: def.name, icon: def.icon, unlockedAt: new Date().toISOString() });
  addActivity(user, 'badge', `Insígnia desbloqueada: ${def.icon} ${def.name}`);
  return true;
}

function dateKey(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Atualiza a sequência de dias consecutivos com base na última visita.
// Chamada em login e em auth-me, então é idempotente no mesmo dia.
function touchDailyVisit(user) {
  ensureEngagementFields(user);

  const today = dateKey(new Date());
  if (user.lastVisit === today) {
    return { user, changed: false };
  }

  const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const isFirstVisit = !user.lastVisit;

  if (user.lastVisit === yesterday) {
    user.streak += 1;
  } else {
    user.streak = 1;
  }
  user.lastVisit = today;

  if (isFirstVisit) {
    awardBadge(user, 'boas_vindas');
    addActivity(user, 'login', 'Primeiro acesso ao Trem Forge.');
  } else {
    addActivity(user, 'login', `Login realizado — sequência de ${user.streak} dia(s).`);
  }

  if (user.streak === 3) awardBadge(user, 'streak_3');
  if (user.streak === 7) awardBadge(user, 'streak_7');
  if (user.streak === 30) awardBadge(user, 'streak_30');

  return { user, changed: true };
}

// Credita quem indicou (se o código de indicação for válido) e devolve
// se a indicação foi aplicada.
async function applyReferral(newUser, refCode) {
  if (!refCode) return false;
  const refs = referralsStore();
  const referrerEmail = await refs.get(String(refCode).toUpperCase(), { type: 'text' });
  if (!referrerEmail || referrerEmail === newUser.email) return false;

  const users = usersStore();
  const referrer = await users.get(referrerEmail, { type: 'json' });
  if (!referrer) return false;

  ensureEngagementFields(referrer);
  referrer.referralCount += 1;
  referrer.coinsBalance += 50;
  awardBadge(referrer, 'indicou_amigo');
  addActivity(referrer, 'referral', `${newUser.name || newUser.email} entrou pelo seu link de indicação. +50 créditos.`);
  await users.setJSON(referrerEmail, referrer);

  newUser.coinsBalance += 20;
  newUser.referredBy = referrerEmail;
  addActivity(newUser, 'referral', 'Bônus de boas-vindas por indicação: +20 créditos.');
  return true;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookies(headerValue) {
  const out = {};
  if (!headerValue) return out;
  headerValue.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function buildSessionCookie(token, maxAgeSeconds) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return attrs.join('; ');
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sessionsStore().setJSON(token, {
    userId: user.id,
    email: user.email,
    expiresAt,
  });
  return { token, expiresAt };
}

// Lê a sessão e devolve o registro COMPLETO do usuário (com passwordHash),
// pra uso interno de functions que precisam mutar e regravar o registro
// (ex.: streak/badges). Nunca deve ser exposto direto numa resposta HTTP.
async function getRawSessionUser(event) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await sessionsStore().get(token, { type: 'json' });
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await sessionsStore().delete(token);
    return null;
  }

  const user = await usersStore().get(session.email, { type: 'json' });
  if (!user) return null;

  ensureEngagementFields(user);
  return { user, token };
}

// Lê a sessão a partir do header Cookie de um event do Netlify Function.
// Retorna o registro do usuário (sem passwordHash) ou null.
async function getSessionUser(event) {
  const raw = await getRawSessionUser(event);
  if (!raw) return null;

  const { passwordHash, ...safeUser } = raw.user;
  return { ...safeUser, sessionToken: raw.token };
}

async function destroySession(event) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await sessionsStore().delete(token);
  }
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  usersStore,
  sessionsStore,
  referralsStore,
  userIndexStore,
  mpPreapprovalsStore,
  PLAN_CONFIG,
  normalizeEmail,
  hashPassword,
  verifyPassword,
  isValidEmail,
  parseCookies,
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  getSessionUser,
  getRawSessionUser,
  destroySession,
  json,
  BADGES,
  PROJECT_STATUSES,
  MAX_PROJECTS_PER_USER,
  generateProjectId,
  ensureEngagementFields,
  awardBadge,
  addActivity,
  touchDailyVisit,
  applyReferral,
  generateReferralCode,
};
