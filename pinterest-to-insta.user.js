// ==UserScript==
// @name         Pinterest M3U8 link helper
// @namespace    https://your.namespace.example
// @version      0.4
// @description  Показывает ссылку на .m3u8 под пином и собирает все найденные .m3u8-URL на странице
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
  const seen = new Set();
  const m3u8Urls = new Set();
  const pendingM3u8Urls = new Set();

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

  function getThumbUrl(m3u8Url) {
    const parts = m3u8Url.split('/');
    const lastParts = parts.slice(-4);
    const folders = lastParts.slice(0, 3);
    const filename = lastParts[3];
    const id = filename.replace('.m3u8', '').replace(/\?.*/, '');
    return `https://i.pinimg.com/videos/thumbnails/originals/${folders.join('/')}/${id}.0000000.jpg`;
  }

  function log(...args) {
    //console.log('[CMFV]', ...args);
  }

  // ---------- UI: плавающая панель ----------
  function ensurePanel() {
    if (document.getElementById('m3u8-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'm3u8-panel';
    panel.innerHTML = `
      <div id="m3u8-header">
        <div class="m3u8-title">
          M3U8 найдено <span id="m3u8-count" class="m3u8-badge">0</span>
        </div>
      </div>
      <div id="m3u8-body">
        <table id="m3u8-list"><tbody></tbody></table>
      </div>
    `;
    const css = document.createElement('style');
    css.textContent = `
      #m3u8-panel {
        position: fixed; right: 12px; top: 12px; bottom: 12px; z-index: 99999;
        width: 300px; height: calc(100vh - 24px);
        background: rgba(18,18,18,.4); color: #fff; border-radius: 10px;
        backdrop-filter: blur(6px); box-shadow: 0 10px 22px rgba(0,0,0,.35);
        font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif;
        overflow: hidden;
      }
      #m3u8-header {
        position: sticky; top: 0; z-index: 1;
        padding: 10px 12px; font-weight: 600;
        background: rgba(0,0,0,.4); border-bottom: 1px solid rgba(255,255,255,.08);
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
      }
      .m3u8-title {
        display: flex; align-items: center; gap: 6px;
      }
      .m3u8-badge {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 20px; padding: 2px 6px; border-radius: 999px;
        background: rgba(255,255,255,.12); font-weight: 600;
      }
      #m3u8-body {
        height: calc(100% - 44px);
        overflow: auto;
      }
      #m3u8-list {
        width: 100%; border-collapse: collapse;
      }
      #m3u8-list tr { border-bottom: 1px solid rgba(255,255,255,.06); }
      #m3u8-list td {
        padding: 8px 12px; vertical-align: middle;
      }
      #m3u8-list td:first-child {
        width: 60px; text-align: center;
      }
      #m3u8-list td:last-child {
        display: flex; align-items: center; gap: 8px;
      }
      #m3u8-list tr:hover { background: rgba(255,255,255,.05); }
      .m3u8-thumb {
        width: 34px; height: 34px; object-fit: cover; border-radius: 6px;
      }
    `;
    document.documentElement.appendChild(css);
    document.documentElement.appendChild(panel);
  }

  function addToPanel(url, title) {
    ensurePanel();
    const tbody = document.querySelector('#m3u8-list tbody');
    const count = document.getElementById('m3u8-count');
    if (m3u8Urls.has(url) || pendingM3u8Urls.has(url)) return;
    pendingM3u8Urls.add(url);

    const thumbUrl = getThumbUrl(url);

    const tr = document.createElement('tr');
    const tdImg = document.createElement('td');
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.className = 'm3u8-thumb';
    img.onload = () => {
      pendingM3u8Urls.delete(url);
      m3u8Urls.add(url);
      tdImg.appendChild(img);
      tr.appendChild(tdImg);
      tr.appendChild(tdLink);
      tbody.prepend(tr);
      count.textContent = String(m3u8Urls.size);
    };
    img.onerror = () => {
      pendingM3u8Urls.delete(url);
    };
    const tdLink = document.createElement('td');
    if (title) {
      tdLink.textContent = title;
    }
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

  function handleFoundUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (seen.has(url)) return;
    // исключим файлы заканчивающиеся на 0w.m3u8 или _audio.m3u8
    if (/0w\.m3u8(\?|$)|_audio\.m3u8(\?|$)/i.test(url)) return;
    seen.add(url);

    const hovered = getHoveredElement();
    const pin = findPinContainer(hovered || document.activeElement);

    const title = pin ? (pin.getAttribute('aria-label') || pin.textContent?.trim().slice(0,60)) : '';
    addToPanel(url, title);
    log('M3U8:', url, 'panel-only');
  }

  // ---------- перехват fetch / XHR ----------
  function patchFetch() {
    if (window._m3u8_fetch_patched) return;
    window._m3u8_fetch_patched = true;

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const req = args[0];
        const url = (req && req.url) ? req.url : String(req);
        if (/\.m3u8(\?|$)/i.test(url)) handleFoundUrl(url);
      } catch (e) {}
      return origFetch.apply(this, args).then(res => {
        try {
          const url = res.url || (args[0] && args[0].url) || String(args[0]);
          if (/\.m3u8(\?|$)/i.test(url)) handleFoundUrl(url);
        } catch (e) {}
        return res;
      });
    };
  }

  function patchXHR() {
    if (window._m3u8_xhr_patched) return;
    window._m3u8_xhr_patched = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      this._m3u8_url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      try {
        const url = this._m3u8_url;
        if (url && /\.m3u8(\?|$)/i.test(url)) handleFoundUrl(url);
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
      log('M3U8 helper started');
    } catch (e) {
      console.error('[M3U8] init error', e);
    }
  });

})();
