/**
 * Trem Forge — i18n engine (unificado)
 * Suporta: pt-BR (padrão), en, es, fr, de, it, zh, ja
 *
 * Uso no HTML:
 *   data-i18n="chave.aninhada"                  -> substitui textContent
 *   data-i18n-html="chave.aninhada"              -> substitui innerHTML (permite <em>, <strong> etc.)
 *   data-i18n-placeholder="chave"                -> substitui atributo placeholder
 *   data-i18n-aria-label="chave"                 -> substitui atributo aria-label
 *   data-i18n-title="chave"                      -> substitui atributo title
 *   data-i18n-attr="placeholder:chave;title:chave2"  -> substitui vários atributos de uma vez
 *
 * Uso no JS:
 *   TremForgeI18n.init().then(function(){ ... código que depende de traduções ... })
 *   TremForgeI18n.t('login.msg_success')
 *   TremForgeI18n.t('login.forgot.subtitle_sms', { email: 'a@b.com' })
 *   TremForgeI18n.setLang('en')
 *
 * Seletor de idioma automático:
 *   <select class="tf-lang-switch"></select>  -> populado e conectado automaticamente
 *   ou chame TremForgeI18n.initLangSwitcher('#meuSelect') manualmente
 *
 * Adicionar um idioma novo:
 *   1. Criar /i18n/<codigo>.json com a mesma estrutura de chaves de pt-BR.json
 *   2. Adicionar o código (e o rótulo/bandeira) no array SUPPORTED_LANGS abaixo
 */
(function (global) {
  var SUPPORTED_LANGS = ['pt-BR', 'en', 'es', 'fr', 'de', 'it', 'zh', 'ja'];
  var LANG_META = {
    'pt-BR': '🇧🇷 PT', en: '🇺🇸 EN', es: '🇪🇸 ES', fr: '🇫🇷 FR',
    de: '🇩🇪 DE', it: '🇮🇹 IT', zh: '🇨🇳 ZH', ja: '🇯🇵 JA'
  };
  var DEFAULT_LANG = 'pt-BR';
  var STORAGE_KEY = 'tf_lang';

  var cache = {};
  var currentLang = DEFAULT_LANG;
  var currentDict = {};
  var currentFlatDict = {};
  var readyPromise = null;

  function detectLang() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* localStorage indisponível */ }
    if (saved && SUPPORTED_LANGS.indexOf(saved) !== -1) return saved;

    var nav = (global.navigator && (navigator.language || navigator.userLanguage)) || DEFAULT_LANG;
    var exact = SUPPORTED_LANGS.filter(function (l) { return l.toLowerCase() === nav.toLowerCase(); })[0];
    if (exact) return exact;

    var short = nav.split('-')[0].toLowerCase();
    var partial = SUPPORTED_LANGS.filter(function (l) { return l.split('-')[0].toLowerCase() === short; })[0];
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
    return fetch('/i18n/' + lang + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('i18n: falha ao carregar ' + lang);
        return r.json();
      })
      .then(function (json) {
        var entry = { tree: json, flat: flatten(json) };
        cache[lang] = entry;
        return entry;
      });
  }

  function t(key, vars) {
    var text = currentFlatDict[key];
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
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }

    var htmlNodes = root.querySelectorAll('[data-i18n-html]');
    for (var i2 = 0; i2 < htmlNodes.length; i2++) {
      htmlNodes[i2].innerHTML = t(htmlNodes[i2].getAttribute('data-i18n-html'));
    }

    var phNodes = root.querySelectorAll('[data-i18n-placeholder]');
    for (var i3 = 0; i3 < phNodes.length; i3++) {
      phNodes[i3].setAttribute('placeholder', t(phNodes[i3].getAttribute('data-i18n-placeholder')));
    }

    var ariaNodes = root.querySelectorAll('[data-i18n-aria-label]');
    for (var i4 = 0; i4 < ariaNodes.length; i4++) {
      ariaNodes[i4].setAttribute('aria-label', t(ariaNodes[i4].getAttribute('data-i18n-aria-label')));
    }

    var titleNodes = root.querySelectorAll('[data-i18n-title]');
    for (var i5 = 0; i5 < titleNodes.length; i5++) {
      titleNodes[i5].setAttribute('title', t(titleNodes[i5].getAttribute('data-i18n-title')));
    }

    var attrNodes = root.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var spec = attrNodes[j].getAttribute('data-i18n-attr');
      spec.split(';').forEach(function (pair) {
        var parts = pair.split(':');
        if (parts.length !== 2) return;
        var attr = parts[0].trim();
        var key = parts[1].trim();
        if (!attr || !key) return;
        attrNodes[j].setAttribute(attr, t(key));
      });
    }

    document.documentElement.setAttribute('lang', currentLang);
  }

  function buildSwitchers() {
    document.querySelectorAll('.tf-lang-switch').forEach(function (sel) {
      if (!sel.dataset.tfBuilt) {
        sel.dataset.tfBuilt = '1';
        SUPPORTED_LANGS.forEach(function (code) {
          var opt = document.createElement('option');
          opt.value = code;
          opt.textContent = LANG_META[code] || code;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function () { setLang(sel.value); });
      }
      if (sel.value !== currentLang) sel.value = currentLang;
    });
  }

  function setLang(lang) {
    if (SUPPORTED_LANGS.indexOf(lang) === -1) lang = DEFAULT_LANG;
    return loadLang(lang).then(function (entry) {
      currentLang = lang;
      currentDict = entry.tree;
      currentFlatDict = entry.flat;
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
      global.TF_CURRENT_LANG = lang;
      applyToDom();
      buildSwitchers();
      var detail = { lang: lang, dict: currentDict };
      document.dispatchEvent(new CustomEvent('tf-i18n-ready', { detail: detail }));
      document.dispatchEvent(new CustomEvent('tf:langchange', { detail: detail }));
      return currentDict;
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
    el.classList.add('tf-lang-switch');
    buildSwitchers();
  }

  // Auto-inicializa assim que o DOM estiver pronto — nenhuma página precisa
  // chamar init() manualmente, mas quem quiser aguardar a tradução antes de
  // rodar algo (ex: docs.html) ainda pode usar TremForgeI18n.init().then(...)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.TremForgeI18n = {
    SUPPORTED: SUPPORTED_LANGS,
    SUPPORTED_LANGS: SUPPORTED_LANGS,
    DEFAULT_LANG: DEFAULT_LANG,
    init: init,
    setLang: setLang,
    t: t,
    applyToDom: applyToDom,
    initLangSwitcher: initLangSwitcher,
    getLang: function () { return currentLang; }
  };
})(window);
