/**
 * Trem Forge — i18n engine
 * Suporta: pt (padrão), en, es, fr, de, zh, ja
 *
 * Uso no HTML:
 *   data-i18n="chave.aninhada"            -> substitui textContent
 *   data-i18n-html="chave.aninhada"       -> substitui innerHTML (permite <em>, <strong> etc.)
 *   data-i18n-placeholder="chave"         -> substitui atributo placeholder
 *   data-i18n-aria-label="chave"          -> substitui atributo aria-label
 *   data-i18n-title="chave"               -> substitui atributo title
 *
 * Adicionar um idioma novo:
 *   1. Criar /i18n/<codigo>.json com a mesma estrutura de chaves do pt.json
 *   2. Adicionar o código no array SUPPORTED_LANGS abaixo
 */
(function () {
  var SUPPORTED_LANGS = ['pt', 'en', 'es', 'fr', 'de', 'zh', 'ja'];
  var DEFAULT_LANG = 'pt';
  var STORAGE_KEY = 'tf_lang';
  var cache = {};

  function detectLang() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved && SUPPORTED_LANGS.indexOf(saved) !== -1) return saved;

    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    var short = nav.slice(0, 2);
    if (SUPPORTED_LANGS.indexOf(short) !== -1) return short;
    return DEFAULT_LANG;
  }

  function getPath(obj, path) {
    return path.split('.').reduce(function (acc, key) {
      return (acc && acc[key] !== undefined) ? acc[key] : undefined;
    }, obj);
  }

  function loadLang(lang) {
    if (cache[lang]) return Promise.resolve(cache[lang]);
    return fetch('/i18n/' + lang + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('i18n: falha ao carregar ' + lang);
        return r.json();
      })
      .then(function (data) {
        cache[lang] = data;
        return data;
      });
  }

  function applyTranslations(dict) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var val = getPath(dict, el.getAttribute('data-i18n'));
      if (val !== undefined) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var val = getPath(dict, el.getAttribute('data-i18n-html'));
      if (val !== undefined) el.innerHTML = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var val = getPath(dict, el.getAttribute('data-i18n-placeholder'));
      if (val !== undefined) el.setAttribute('placeholder', val);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var val = getPath(dict, el.getAttribute('data-i18n-aria-label'));
      if (val !== undefined) el.setAttribute('aria-label', val);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var val = getPath(dict, el.getAttribute('data-i18n-title'));
      if (val !== undefined) el.setAttribute('title', val);
    });
  }

  function setLang(lang) {
    if (SUPPORTED_LANGS.indexOf(lang) === -1) lang = DEFAULT_LANG;
    return loadLang(lang).then(function (dict) {
      applyTranslations(dict);
      document.documentElement.setAttribute('lang', lang === 'pt' ? 'pt-BR' : lang);
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
      window.TF_CURRENT_LANG = lang;
      document.querySelectorAll('.tf-lang-switch').forEach(function (sel) {
        if (sel.value !== lang) sel.value = lang;
      });
      document.dispatchEvent(new CustomEvent('tf:langchange', { detail: { lang: lang, dict: dict } }));
    });
  }

  function buildSwitcher() {
    var metas = {
      pt: '🇧🇷 PT', en: '🇺🇸 EN', es: '🇪🇸 ES', fr: '🇫🇷 FR',
      de: '🇩🇪 DE', zh: '🇨🇳 ZH', ja: '🇯🇵 JA'
    };
    document.querySelectorAll('.tf-lang-switch').forEach(function (sel) {
      if (sel.dataset.tfBuilt) return;
      sel.dataset.tfBuilt = '1';
      SUPPORTED_LANGS.forEach(function (code) {
        var opt = document.createElement('option');
        opt.value = code;
        opt.textContent = metas[code] || code;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { setLang(sel.value); });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildSwitcher();
    setLang(detectLang());
  });

  window.TremForgeI18n = { setLang: setLang, SUPPORTED_LANGS: SUPPORTED_LANGS };
})();
