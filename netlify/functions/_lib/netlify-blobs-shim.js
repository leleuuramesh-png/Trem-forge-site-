// netlify/functions/_lib/netlify-blobs-shim.js
//
// Substitui '@netlify/blobs' por Cloudflare Workers KV, com a MESMA
// interface que auth.js / portfolio-*.js já usam:
//   getStore({ name })  ou  getStore('nome')
//   store.get(key, { type: 'json' | 'text' })
//   store.setJSON(key, value)
//   store.set(key, text)
//   store.delete(key)
//   store.list({ prefix })  -> { blobs: [{ key }, ...] }
//
// Todos os "stores" (users, sessions, referrals, ...) vivem no MESMO
// namespace de KV (TF_KV, configurado no wrangler.toml), diferenciados
// por um prefixo `${storeName}::`. Isso evita ter que criar um
// namespace do Cloudflare por store — o Netlify Blobs também era só um
// key-value por trás dos panos.
//
// __setKV(kvNamespace) precisa ser chamado uma vez por request (feito
// pelo adaptador em functions/api/[[route]].js) antes de qualquer
// function rodar, porque o binding do KV só existe dentro do contexto
// da request no Cloudflare Pages Functions.

let _KV = null;

function __setKV(kvNamespace) {
  _KV = kvNamespace;
}

function resolveStoreName(nameOrOpts) {
  if (typeof nameOrOpts === 'string') return nameOrOpts;
  if (nameOrOpts && typeof nameOrOpts.name === 'string') return nameOrOpts.name;
  throw new Error('netlify-blobs-shim: getStore() precisa de um nome de store.');
}

function getStore(nameOrOpts) {
  if (!_KV) {
    throw new Error(
      'netlify-blobs-shim: KV namespace não inicializado. __setKV(env.TF_KV) precisa ser chamado antes.'
    );
  }
  const storeName = resolveStoreName(nameOrOpts);
  const prefix = `${storeName}::`;

  return {
    async get(key, opts) {
      const type = opts && opts.type;
      if (type === 'json') {
        const val = await _KV.get(prefix + key, 'json');
        return val === undefined ? null : val;
      }
      const val = await _KV.get(prefix + key, 'text');
      return val === undefined ? null : val;
    },

    async setJSON(key, value) {
      await _KV.put(prefix + key, JSON.stringify(value));
      return true;
    },

    async set(key, value) {
      await _KV.put(prefix + key, typeof value === 'string' ? value : String(value));
      return true;
    },

    async delete(key) {
      await _KV.delete(prefix + key);
    },

    // Netlify Blobs pagina com { blobs, cursor }; aqui devolvemos tudo de
    // uma vez (list() do Workers KV já pagina até 1000 chaves por
    // chamada, suficiente pro volume desses stores).
    async list(opts) {
      const listPrefix = prefix + ((opts && opts.prefix) || '');
      const out = [];
      let cursor;
      do {
        const res = await _KV.list({ prefix: listPrefix, cursor });
        for (const k of res.keys) {
          out.push({ key: k.name.slice(prefix.length) });
        }
        cursor = res.list_complete ? undefined : res.cursor;
      } while (cursor);
      return { blobs: out };
    },
  };
}

module.exports = { getStore, __setKV };
