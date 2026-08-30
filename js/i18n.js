/**
 * Trem Forge — i18n mínimo, sem dependências.
 * Uso:
 *   TremForgeI18n.init().then(function(){ ... seu código que depende de traduções ... });
 *   <span data-i18n="login.title"></span>
 *   <input data-i18n-attr="placeholder:login.signup.placeholder_phone">
 *   TremForgeI18n.t('login.msg_success')
 *   TremForgeI18n.t('login.forgot.subtitle_sms', { email: 'a@b.com' })
 */
(function (global) {
  var SUPPORTED = ['pt-BR', 'en', 'es', 'fr', 'de', 'it', 'ja'];
  var DEFAULT_LANG = 'pt-BR';
  var STORAGE_KEY = 'tf_lang';

  var cache = {};
  var currentLang = DEFAULT_LANG;
  var currentDict = {};
  var readyPromise = null;

  function detectLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (e) { /* localStorage indisponível */ }

    var nav = (global.navigator && (navigator.language || navigator.userLanguage)) || DEFAULT_LANG;
    var exact = SUPPORTED.filter(function (l) { return l.toLowerCase() === nav.toLowerCase(); })[0];
    if (exact) return exact;

    var short = nav.split('-')[0].toLowerCase();
    var partial = SUPPORTED.filter(function (l) { return l.split('-')[0].toLowerCase() === short; })[0];
    return partial || DEFAULT_LANG;
  }

  function flatten(obj, prefix, out) {
    out = out || {};
    prefix = prefix || '';
    Object.keys(obj).forEach(function (k) {
      var val = obj[k];
      var key = prefix ? prefix + '.' + k : k;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        flatten(val, key, out);
      } else {
        out[key] = val;
      }
    });
    return out;
  }

  function loadLang(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    return fetch('/locales/' + lang + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Falha ao carregar locale: ' + lang);
        return r.json();
      })
      .then(function (json) {
        var flat = flatten(json);
        cache[lang] = flat;
        return flat;
      });
  }

  function t(key, vars) {
    var text = currentDict[key];
    if (text == null) return key; // fallback visível em vez de quebrar a UI
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        text = text.split('{' + k + '}').join(vars[k]);
      });
    }
    return text;
  }

  function applyToDom(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      node.textContent = t(node.getAttribute('data-i18n'));
    }

    var attrNodes = root.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var attrNode = attrNodes[j];
      var spec = attrNode.getAttribute('data-i18n-attr');
      spec.split(';').forEach(function (pair) {
        var parts = pair.split(':');
        if (parts.length !== 2) return;
        var attr = parts[0].trim();
        var key = parts[1].trim();
        if (!attr || !key) return;
        attrNode.setAttribute(attr, t(key));
      });
    }

    document.documentElement.setAttribute('lang', currentLang);
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
    return loadLang(lang).then(function (flat) {
      currentLang = lang;
      currentDict = flat;
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
      applyToDom();
      document.dispatchEvent(new CustomEvent('tf-i18n-ready', { detail: { lang: lang } }));
      return flat;
    });
  }

  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = setLang(detectLang());
    return readyPromise;
  }

  function initLangSwitcher(selector) {
    var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    el.value = currentLang;
    el.addEventListener('change', function () { setLang(el.value); });
    document.addEventListener('tf-i18n-ready', function (e) { el.value = e.detail.lang; });
  }

  global.TremForgeI18n = {
    SUPPORTED: SUPPORTED,
    DEFAULT_LANG: DEFAULT_LANG,
    init: init,
    setLang: setLang,
    t: t,
    applyToDom: applyToDom,
    initLangSwitcher: initLangSwitcher,
    getLang: function () { return currentLang; }
  };
})(window);
