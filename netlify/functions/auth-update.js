// netlify/functions/auth-update.js
//
// POST /.netlify/functions/auth-update
// Body JSON: { "name"?: "...", "phone"?: "..." }
//
// Atualiza dados simples de perfil do usuário logado (nome de exibição
// e/ou telefone). Protegido por sessão (cookie tf_session). Os dois
// campos são independentes: manda só o que quer mudar. "phone" vazio
// ("") remove o telefone cadastrado (desativa a opção de SMS).

const {
  usersStore,
  getRawSessionUser,
  normalizePhone,
  isValidPhone,
  addActivity,
  json,
} = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const raw = await getRawSessionUser(event);
  if (!raw) return json(401, { error: 'Não autenticado.' });

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'JSON inválido' });
  }

  const hasName = Object.prototype.hasOwnProperty.call(data, 'name');
  const hasPhone = Object.prototype.hasOwnProperty.call(data, 'phone');

  if (!hasName && !hasPhone) {
    return json(400, { error: 'Nada para atualizar.' });
  }

  const user = raw.user;
  let changed = false;

  if (hasName) {
    const name = String(data.name || '').trim();
    if (!name || name.length < 2) {
      return json(400, { error: 'Informe um nome válido.' });
    }
    if (name.length > 60) {
      return json(400, { error: 'Nome muito longo.' });
    }
    if (user.name !== name) {
      user.name = name;
      changed = true;
      addActivity(user, 'profile', 'Nome de exibição atualizado.');
    }
  }

  if (hasPhone) {
    const phoneRaw = String(data.phone || '').trim();
    if (!phoneRaw) {
      // Campo vazio: remove o telefone cadastrado.
      if (user.phone) {
        user.phone = null;
        changed = true;
        addActivity(user, 'profile', 'Telefone removido da conta.');
      }
    } else {
      if (!isValidPhone(phoneRaw)) {
        return json(400, { error: 'Telefone inválido. Informe DDD + número (ex: 11 91234-5678).' });
      }
      const phone = normalizePhone(phoneRaw);
      if (user.phone !== phone) {
        user.phone = phone;
        changed = true;
        addActivity(user, 'profile', 'Telefone atualizado.');
      }
    }
  }

  if (changed) {
    await usersStore().setJSON(user.email, user);
  }

  const { passwordHash, ...safeUser } = user;
  return json(200, { ok: true, user: safeUser });
};
