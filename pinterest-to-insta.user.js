// ==UserScript==
// @name         Pinterest CMFV link helper
// @namespace    https://your.namespace.example
// @version      0.3
// @description  Показывает ссылку на .cmfv под пином и собирает все найденные .cmfv-URL на странице
// @match        https://www.pinterest.*/*
// @match        https://pinterest.com/*
// @match        https://www.pinterest.com/*
// @run-at       document-start
// @grant        none33
// @updateURL    https://raw.githubusercontent.com/Tav25/__MN_pinterstToInsta/master/pinterest-to-insta.user.js
// @downloadURL  https://raw.githubusercontent.com/Tav25/__MN_pinterstToInsta/master/pinterest-to-insta.user.js

// ==/UserScript==

(function () {
  'use strict';

  // ---------- утилиты ----------
  

  // простая защита от дубликатов и трекинга
  function normalizeUrl(u) {
    try {
      const url = new URL(u, location.href);
      // убираем явные трекинг-параметры (на всякий)
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p => url.searchParams.delete(p));
      return url.toString();
    } catch (e) {
      return String(u);
    }
  }

  function log(...args) {
    //console.log('[CMFV]', ...args);
  }

  // ---------- UI: плавающая панель ----------
  function ensurePanel() {
    if (document.getElementById('cmfv-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'cmfv-panel';
    panel.innerHTML = `
      <div id="cmfv-header">CMFV найдено <span id="cmfv-count">0</span></div>
      <div id="cmfv-list"></div>
    `;
    const css = document.createElement('style');
    css.textContent = `
      #cmfv-panel {
        position: fixed; right: 12px; bottom: 12px; z-index: 99999;
        width: 320px; max-height: 45vh; overflow: auto;
        background: rgba(20,20,20,.9); color: #fff; border-radius: 8px;
        backdrop-filter: blur(4px); box-shadow: 0 6px 18px rgba(0,0,0,.35);
        font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif;
      }
      #cmfv-header {
        position: sticky; top: 0; padding: 10px 12px; font-weight: 600;
        background: rgba(0,0,0,.35); border-bottom: 1px solid rgba(255,255,255,.1);
      }
      #cmfv-list a {
        display: block; padding: 8px 12px; text-decoration: none;
        color: #bde0ff; word-break: break-all;
      }
      #cmfv-list a:hover { background: rgba(255,255,255,.06); }
      .cmfv-chip {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(20,20,20,.85); color: #bde0ff;
        border: 1px solid rgba(189,224,255,.25);
        padding: 6px 8px; margin-top: 6px; border-radius: 6px; font-size: 12px;
      }
      .cmfv-chip a { color: #bde0ff; text-decoration: none; }
      .cmfv-chip a:hover { text-decoration: underline; }
    `;
    document.documentElement.appendChild(css);
    document.documentElement.appendChild(panel);
  }

  function addToPanel(url, title) {
    ensurePanel();
    const list = document.getElementById('cmfv-list');
    const count = document.getElementById('cmfv-count');
    if (cmfvUrls.has(url)) return;
    cmfvUrls.add(url);

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = title ? `${title} — ${url}` : url;
    list.prepend(a);
    count.textContent = String(cmfvUrls.size);
  }

  // ---------- привязка к карточке пина ----------
  function getHoveredElement() {
    const path = document.querySelectorAll(':hover');
    if (!path || !path.length) return null;
    return path[path.length - 1];
  }

  function findPinContainer(startEl) {
    if (!startEl) return null;
    let el = startEl;
    // попытка найти обёртку пина как можно выше:
    const isPinLike = (node) => {
      if (!node || node.nodeType !== 1) return false;
      // эвристики: ссылка на /pin/..., роль listitem, явные data-атрибуты, видео/картинка внутри
      if (node.matches('a[href*="/pin/"]')) return true;
      if (node.matches('[role="listitem"]')) return true;
      if (node.matches('div[data-test-id*="pin"], div[data-test-id*="Pin"], div[class*="Pin"]')) return true;
      if (node.querySelector && (node.querySelector('a[href*="/pin/"]') || node.querySelector('video,img'))) return true;
      return false;
    };
    while (el && el !== document.documentElement) {
      if (isPinLike(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function extractPinKey(container) {
    if (!container) return null;
    // пробуем достать собственно id пина из ссылки
    const a = container.closest('a[href*="/pin/"]') || container.querySelector('a[href*="/pin/"]');
    if (a) {
      const m = a.href.match(/\/pin\/(\d+)/);
      if (m) return `pin:${m[1]}`;
      return `href:${a.href}`;
    }
    // запасной вариант — путь в DOM
    return container.id ? `node#${container.id}` : `node@${(container.className||'').toString().slice(0,80)}`;
  }

  function attachChip(container, url) {
    if (!container) return false;
    const pinKey = extractPinKey(container);
    if (!pinKey) return false;

    // если уже добавляли чип к этому пину — обновим URL
    let chip = container.querySelector('.cmfv-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'cmfv-chip';
      chip.innerHTML = `🎬 <a target="_blank" rel="noopener">Открыть .cmfv</a>`;
      // вставим ближе к низу карточки; где «безопаснее» — перед концом контейнера
      container.appendChild(chip);
    }
    const link = chip.querySelector('a');
    link.href = url;

    pinLinks.set(pinKey, url);
    return true;
  }

  function handleFoundUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (seen.has(url)) return;
    seen.add(url);

    // 1) пробуем привязать к карточке под курсором
    const hovered = getHoveredElement();
    const pin = findPinContainer(hovered || document.activeElement);
    const attached = attachChip(pin, url);

    // 2) в любом случае — добавим в плавающую панель
    const title = pin ? (pin.getAttribute('aria-label') || pin.textContent?.trim().slice(0,60)) : '';
    addToPanel(url, title);
    log('CMFV:', url, attached ? 'attached' : 'panel-only');
  }

  // ---------- перехват fetch / XHR ----------
  function patchFetch() {
    if (window._cmfv_fetch_patched) return;
    window._cmfv_fetch_patched = true;

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const req = args[0];
        const url = (req && req.url) ? req.url : String(req);
        if (/\.cmfv(\?|$)/i.test(url)) handleFoundUrl(url);
      } catch (e) {}
      return origFetch.apply(this, args).then(res => {
        try {
          const url = res.url || (args[0] && args[0].url) || String(args[0]);
          if (/\.cmfv(\?|$)/i.test(url)) handleFoundUrl(url);
        } catch (e) {}
        return res;
      });
    };
  }

  function patchXHR() {
    if (window._cmfv_xhr_patched) return;
    window._cmfv_xhr_patched = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      this._cmfv_url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      try {
        const url = this._cmfv_url;
        if (url && /\.cmfv(\?|$)/i.test(url)) handleFoundUrl(url);
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }

  // ---------- SPA-навигация / инициализация ----------
  function onReady(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  }

  function hookHistory() {
    // чтобы скрипт «жив» оставался при внутрисайтовой навигации
    const push = history.pushState;
    const replace = history.replaceState;
    function rerun() {
      setTimeout(() => {
        ensurePanel();
      }, 50);
    }
    history.pushState = function () { const r = push.apply(this, arguments); rerun(); return r; };
    history.replaceState = function () { const r = replace.apply(this, arguments); rerun(); return r; };
    window.addEventListener('popstate', rerun);
  }

  // ---------- старт ----------
  onReady(() => {
    try {
      ensurePanel();
      patchFetch();
      patchXHR();
      hookHistory();
      log('CMFV helper started');
    } catch (e) {
      console.error('[CMFV] init error', e);
    }
  });

})();
