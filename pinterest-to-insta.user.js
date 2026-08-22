// ==UserScript==
// @name         Pinterest M3U8 link helper
// @namespace    https://github.com/Tav25
// @version      0.75
// @description  Показывает ссылку на .m3u8 под пином и собирает все найденные .m3u8-URL на странице
// @match        https://*.pinterest.com/*
// @match        https://*.pinterest.*/*
// @match        https://pinterest.*/*
// @run-at       document-start
// @grant        none
// @noframe
// @updateURL    https://raw.githubusercontent.com/Tav25/__MN_pinterstToInsta/master/pinterest-to-insta.user.js
// @downloadURL  https://raw.githubusercontent.com/Tav25/__MN_pinterstToInsta/master/pinterest-to-insta.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- утилиты ----------
  const seen = new Set();
  const m3u8Urls = new Set();
  const pendingM3u8Urls = new Set();

  // localStorage для добавленных ссылок
  function addToStorage(url) {
    let links = JSON.parse(localStorage.getItem('addedM3u8Links') || '[]');
    if (links.includes(url)) return false;
    links.push(url);
    localStorage.setItem('addedM3u8Links', JSON.stringify(links));
    return true;
  }

  function getStoredLinks() {
    return JSON.parse(localStorage.getItem('addedM3u8Links') || '[]');
  }

  function removeFromStorage(url) {
    const links = getStoredLinks();
    const nextLinks = links.filter(link => link !== url);
    if (nextLinks.length === links.length) return false;
    localStorage.setItem('addedM3u8Links', JSON.stringify(nextLinks));
    return true;
  }

  function clearStoredLinks() {
    localStorage.removeItem('addedM3u8Links');
  }

  function updateStoredCounts() {
    const total = String(getStoredLinks().length);
    const downloadCount = document.getElementById('m3u8-download-count');
    const footerCount = document.getElementById('m3u8-footer-count');
    if (downloadCount) downloadCount.textContent = total;
    if (footerCount) footerCount.textContent = total;
  }

  function markRowError(url) {
    const row = document.querySelector(`#m3u8-list tr[data-url="${CSS.escape(url)}"]`);
    if (!row) return;
    row.classList.add('m3u8-error');
  }

  function deriveCmfLinks(link) {
    try {
      const url = new URL(link, location.href);
      if (!/\.m3u8$/i.test(url.pathname)) return [];
      const base = url.pathname.replace(/\.m3u8$/i, '');
      const videoUrl = new URL(url.toString());
      let videoPath = `${base}_720w.mp4`;
      if (!/\/expMp4\//i.test(videoPath)) {
        if (/\/videos\/iht\/hls\//i.test(videoPath)) {
          videoPath = videoPath.replace('/videos/iht/hls/', '/videos/iht/expMp4/');
        } else {
          videoPath = videoPath.replace('/videos/', '/videos/iht/expMp4/');
        }
      }
      videoUrl.pathname = videoPath;
      return [videoUrl.toString()];
    } catch (e) {
      return [];
    }
  }

  function downloadLinks() {
    try {
      const links = getStoredLinks();
      const downloadSet = new Set();
      links.forEach(link => {
        if (/(_720w\.mp4)(\?|$)/i.test(link)) {
          downloadSet.add(link);
          return;
        }
        deriveCmfLinks(link).forEach(derived => downloadSet.add(derived));
      });
      const downloadLinks = Array.from(downloadSet);
      if (downloadLinks.length === 0) {
        alert('Нет добавленных ссылок для скачивания.');
        return;
      }
      const text = downloadLinks.join('\n');
      const blob = new Blob([text], {type: 'text/plain'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'm3u8_links.txt';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Ошибка при скачивании: ' + e.message);
    }
  }

  async function downloadFilesSequentially() {
    const links = getStoredLinks();
    const downloadMap = new Map();
    links.forEach(link => {
      if (/(_720w\.mp4)(\?|$)/i.test(link)) {
        downloadMap.set(link, link);
        return;
      }
      deriveCmfLinks(link).forEach(derived => downloadMap.set(derived, link));
    });
    const downloadItems = Array.from(downloadMap.entries()).map(([link, source]) => ({ link, source }));
    if (downloadItems.length === 0) {
      alert('Нет добавленных ссылок для скачивания.');
      return;
    }
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const getFileName = (link) => {
      try {
        const url = new URL(link);
        const last = url.pathname.split('/').pop();
        return last || 'pinterest-video.mp4';
      } catch (e) {
        return 'pinterest-video.mp4';
      }
    };
    for (const { link, source } of downloadItems) {
      try {
        const response = await fetch(link, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error('fetch failed');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = getFileName(link);
        a.rel = 'noopener';
        a.click();
        URL.revokeObjectURL(blobUrl);
      } catch (e) {
        if (removeFromStorage(source)) {
          updateStoredCounts();
        }
        markRowError(source);
      }
      await delay(350);
    }
  }

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
    console.log('[CMFV]', ...args);
  }

  // ---------- UI: плавающая панель ----------
  function ensurePanel() {
    if (document.getElementById('m3u8-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'm3u8-panel';
    panel.innerHTML = `
      <div id="m3u8-header">
        <div class="m3u8-title">
          VD <span id="m3u8-count" class="m3u8-badge">0</span>
        </div>
        <button id="download-btn" class="m3u8-btn m3u8-btn-primary m3u8-btn-download" aria-label="Скачать">
          <svg class="m3u8-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"></path>
            <path d="M7 10l5 5 5-5"></path>
            <path d="M5 21h14"></path>
          </svg>
          <span id="m3u8-download-count" class="m3u8-btn-count">0</span>
        </button>
        <button id="download-files-btn" class="m3u8-btn m3u8-btn-primary m3u8-btn-files" aria-label="Скачать файлы">
          <svg class="m3u8-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v10"></path>
            <path d="M8 9l4 4 4-4"></path>
            <path d="M5 19h14"></path>
          </svg>
        </button>
      </div>
      <div id="m3u8-body">
        <table id="m3u8-list"><tbody></tbody></table>
      </div>
      <div id="m3u8-footer">
        <span>ADD: <span id="m3u8-footer-count">0</span></span>
        <div class="m3u8-footer-actions">
          <button id="expand-btn" class="m3u8-btn m3u8-btn-expand" aria-label="Развернуть">
            <svg class="m3u8-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 10V4h6"></path>
              <path d="M20 14v6h-6"></path>
              <path d="M4 4l7 7"></path>
              <path d="M20 20l-7-7"></path>
            </svg>
          </button>
          <button id="select-all-btn" class="m3u8-btn m3u8-btn-secondary" type="button">
            Выделить все
          </button>
          <button id="deselect-all-btn" class="m3u8-btn m3u8-btn-secondary" type="button">
            Отменить все
          </button>
          <button id="clear-btn" class="m3u8-btn m3u8-btn-clear" aria-label="Очистить">
            <svg class="m3u8-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M6 6l1 14h10l1-14"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
    const css = document.createElement('style');
    css.textContent = `
      #m3u8-panel {
        position: fixed; right: 20px; top: 20px; bottom: 20px; z-index: 99999;
        width: 175px; height: calc(100vh - 40px);
        background: rgba(18,18,18,.4); color: #fff; border-radius: 5px;
        backdrop-filter: blur(6px); box-shadow: 0 10px 22px rgba(0,0,0,.35);
        font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif;
        overflow: hidden;
      }
      #m3u8-panel.m3u8-panel-expanded {
        top: 20px; right: 20px; bottom: 20px; left: 20px;
        width: auto; height: auto;
        border-radius: 5px;
        padding: 0;
      }
      #m3u8-header {
        position: sticky; top: 0; z-index: 1;
        padding: 6px 8px; font-weight: 600;
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
        height: calc(100% - 88px);
        overflow: auto;
      }
      #m3u8-footer {
        position: sticky; bottom: 0; z-index: 1;
        padding: 6px 8px; font-weight: 500;
        background: rgba(0,0,0,.35); border-top: 1px solid rgba(255,255,255,.08);
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
      }
      .m3u8-footer-actions {
        display: inline-flex; align-items: center; gap: 6px;
      }
      #m3u8-list {
        width: auto; border-collapse: collapse;
      }
      #m3u8-list tbody {
        display: flex; flex-wrap: wrap; gap: 5px; padding: 5px;
      }
      #m3u8-list tr {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        padding: 0;
      }
      #m3u8-list td {
        padding: 0; vertical-align: middle;
      }
      #m3u8-list td:last-child {
        display: flex; align-items: center; justify-content: center; gap: 8px;
      }
      #m3u8-list tr:hover .m3u8-thumb {
        border-color: rgba(255,255,255,.35);
      }
      .m3u8-btn {
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(31,41,55,.7);
        color: #f9fafb;
        border-radius: 5px;
        padding: 4px 10px;
        font-size: 12px; font-weight: 600; cursor: pointer;
        letter-spacing: .2px;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      }
      .m3u8-btn:hover { background: rgba(55,65,81,.85); }
      .m3u8-btn:disabled {
        cursor: default; opacity: .7;
      }
      .m3u8-btn-primary {
        background: #3b82f6; border-color: #3b82f6;
      }
      .m3u8-btn-primary:hover { background: #2563eb; }
      .m3u8-btn-secondary {
        background: rgba(59,130,246,.18); border-color: rgba(59,130,246,.35);
      }
      .m3u8-btn-secondary:hover {
        background: rgba(59,130,246,.3); border-color: rgba(59,130,246,.5);
      }
      #select-all-btn,
      #deselect-all-btn {
        display: none;
      }
      #m3u8-panel.m3u8-panel-expanded #select-all-btn,
      #m3u8-panel.m3u8-panel-expanded #deselect-all-btn {
        display: inline-flex;
      }
      .m3u8-btn-download {
        flex-direction: row; align-items: center; gap: 3px;
        padding: 4px;
        width: 40px; justify-content: center;
      }
      .m3u8-btn-files {
        width: 34px; padding: 4px; justify-content: center;
      }
      .m3u8-btn-expand {
        background: rgba(15,23,42,.85); border-color: rgba(255,255,255,.08);
        padding: 4px 6px;
      }
      .m3u8-btn-expand:hover { background: rgba(30,41,59,.95); }
      .m3u8-btn-open {
        background: rgba(31,41,55,.9); border-color: rgba(255,255,255,.08);
        padding: 4px 9px; font-size: 13px;
      }
      .m3u8-btn-open:hover { background: rgba(55,65,81,.95); }
      .m3u8-icon {
        width: 18px; height: 18px; display: block;
      }
      .m3u8-btn-count {
        font-size: 9px; font-weight: 700; line-height: 1;
      }
      .m3u8-btn-clear {
        background: #f97316; border-color: #f97316; color: #111827;
      }
      .m3u8-btn-clear:hover { background: #ea580c; border-color: #ea580c; }
      .m3u8-added .m3u8-thumb {
        filter: grayscale(100%) brightness(.8);
      }
      .m3u8-error {
        background: rgba(239,68,68,.2);
        border-radius: 6px;
        padding: 4px;
      }
      .m3u8-error .m3u8-thumb {
        filter: grayscale(100%) brightness(.7);
        border-color: rgba(239,68,68,.9);
        box-shadow: 0 0 0 2px rgba(239,68,68,.55), 0 6px 14px rgba(0,0,0,.25);
      }
      .m3u8-thumb {
        width: 41px; height: auto; object-fit: cover; border-radius: 8px; cursor: pointer;
        border: 1px solid rgba(255,255,255,.18);
        box-shadow: 0 6px 14px rgba(0,0,0,.25);
      }
      .m3u8-thumb-fallback {
        display: flex; align-items: center; justify-content: center;
        width: 41px; min-height: 55px;
        background: rgba(255,255,255,.08);
        color: rgba(255,255,255,.6); font-weight: 700;
      }
      td { position: relative; }
      .m3u8-dur {
        position: absolute; left: 4px; bottom: 4px;
        padding: 1px 5px; border-radius: 4px;
        background: rgba(0,0,0,.75); color: #fff;
        font-size: 10px; font-weight: 600; line-height: 1.4;
        pointer-events: none;
      }
      #m3u8-panel.m3u8-panel-expanded .m3u8-thumb {
        width: 82px;
      }
    `;
    document.documentElement.appendChild(css);
    document.documentElement.appendChild(panel);
    document.getElementById('download-btn').addEventListener('click', downloadLinks);
    document.getElementById('download-files-btn').addEventListener('click', downloadFilesSequentially);
    updateStoredCounts();
    document.getElementById('clear-btn').addEventListener('click', () => {
      clearStoredLinks();
      updateStoredCounts();
      document.querySelectorAll('#m3u8-list tr.m3u8-added').forEach(row => {
        row.classList.remove('m3u8-added');
      });
    });
    document.getElementById('select-all-btn').addEventListener('click', () => {
      document.querySelectorAll('#m3u8-list tr').forEach(row => {
        const url = row.dataset.url;
        if (!url) return;
        addToStorage(url);
        row.classList.add('m3u8-added');
      });
      updateStoredCounts();
    });
    document.getElementById('deselect-all-btn').addEventListener('click', () => {
      document.querySelectorAll('#m3u8-list tr').forEach(row => {
        const url = row.dataset.url;
        if (!url) return;
        removeFromStorage(url);
        row.classList.remove('m3u8-added');
      });
      updateStoredCounts();
    });
    document.getElementById('expand-btn').addEventListener('click', () => {
      panel.classList.toggle('m3u8-panel-expanded');
    });
  }

  // ---------- детектирование видео по бейджу длительности ----------
  // у видео-пинов Pinterest на превью есть бейдж «0:10» — используем его
  // как признак видео и источник длительности для панели
  const durationsByPin = new Map(); // pinKey -> '0:10'
  const DURATION_RE = /^(\d{1,2}:\d{2}|\d{1,2}:\d{2}:\d{2})$/;

  // зелёная обводка видео-пинов на странице Pinterest
  function ensureHighlightStyle() {
    if (document.getElementById('m3u8-highlight-style')) return;
    const css = document.createElement('style');
    css.id = 'm3u8-highlight-style';
    css.textContent = `
      [data-test-pin-id].m3u8-video-pin {
        position: relative;
      }
      [data-test-pin-id].m3u8-video-pin::after {
        content: '';
        position: absolute;
        inset: 0;
        border: 3px solid #22c55e;
        border-radius: 16px;
        pointer-events: none;
        z-index: 2147483647;
      }
    `;
    document.documentElement.appendChild(css);
  }

  function markPinAsVideo(pinEl) {
    ensureHighlightStyle();
    pinEl.classList.add('m3u8-video-pin');
  }

  function scanDurationBadges(root) {
    if (!document.body) return;
    // быстрый путь: официальный бейдж Pinterest «PinTypeIdentifier» с текстом «0:13»
    const badges = (root && root.querySelectorAll ? root : document)
      .querySelectorAll('[data-test-id="PinTypeIdentifier"]');
    if (badges.length) {
      badges.forEach(badge => {
        const text = badge.textContent.trim();
        if (!DURATION_RE.test(text)) return;
        const pinEl = badge.closest('[data-test-pin-id]');
        if (!pinEl) return;
        const pinKey = `pin:${pinEl.getAttribute('data-test-pin-id')}`;
        if (durationsByPin.get(pinKey) === text) return;
        durationsByPin.set(pinKey, text);
        markPinAsVideo(pinEl);
        applyDurationToRows(pinKey);
        log('duration detected:', pinKey, text);
      });
      return;
    }
    // запасной путь: поиск любых текстов вида м:сс через TreeWalker
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!DURATION_RE.test(text)) continue;
      const el = node.parentElement;
      const pin = findPinContainer(el);
      if (!pin) continue;
      const pinKey = extractPinKey(pin);
      if (!pinKey) continue;
      if (durationsByPin.get(pinKey) === text) continue;
      durationsByPin.set(pinKey, text);
      markPinAsVideo(pin.closest('[data-test-pin-id]') || pin);
      applyDurationToRows(pinKey);
      log('duration detected:', pinKey, text);
    }
  }

  function watchDurationBadges() {
    scanDurationBadges();
    const mo = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && !n.closest('#m3u8-panel')) { shouldScan = true; break; }
        }
        if (shouldScan) break;
      }
      // скан дешёвый только при новых текстовых бейджах; дебаунсим
      if (shouldScan) {
        clearTimeout(watchDurationBadges._t);
        watchDurationBadges._t = setTimeout(() => scanDurationBadges(), 300);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function applyDurationToRows(pinKey) {
    const dur = durationsByPin.get(pinKey);
    if (!dur) return;
    document.querySelectorAll(`#m3u8-list tr[data-pin="${CSS.escape(pinKey)}"]`).forEach(row => {
      setRowDuration(row, dur);
    });
  }

  function setRowDuration(row, dur) {
    let badge = row.querySelector('.m3u8-dur');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'm3u8-dur';
      const tdImg = row.querySelector('td');
      if (tdImg) tdImg.appendChild(badge);
    }
    badge.textContent = dur;
  }

  function addToPanel(url, title, pinKey) {
    ensurePanel();
    const tbody = document.querySelector('#m3u8-list tbody');
    if (!tbody) return;
    if (m3u8Urls.has(url) || pendingM3u8Urls.has(url)) return;
    pendingM3u8Urls.add(url);

    const thumbUrl = getThumbUrl(url);
    const previewUrl = deriveCmfLinks(url)[0] || url;

    const tr = document.createElement('tr');
    tr.dataset.url = url;
    if (pinKey) tr.dataset.pin = pinKey;
    const tdImg = document.createElement('td');
    let appended = false;
    const appendRow = (thumbNode) => {
      if (appended) return;
      appended = true;
      tdImg.appendChild(thumbNode);
      tr.appendChild(tdImg);
      tr.appendChild(tdLink);
      tbody.prepend(tr);
      if (pinKey && durationsByPin.has(pinKey)) {
        setRowDuration(tr, durationsByPin.get(pinKey));
      }
    };
    const markAdded = () => {
      tr.classList.add('m3u8-added');
      updateStoredCounts();
    };
    const markRemoved = () => {
      tr.classList.remove('m3u8-added');
      updateStoredCounts();
    };

    const tdLink = document.createElement('td');
    const btnOpen = document.createElement('button');
    btnOpen.innerHTML = `
      <svg class="m3u8-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    btnOpen.setAttribute('aria-label', 'Открыть');
    btnOpen.className = 'm3u8-btn m3u8-btn-open';
    btnOpen.onclick = () => {
      try {
        window.open(previewUrl, '_blank');
      } catch (e) {
        alert('Не удалось открыть ссылку: ' + e.message);
      }
    };
    if (getStoredLinks().includes(url)) {
      markAdded();
    }
    const handleToggle = () => {
      if (getStoredLinks().includes(url)) {
        if (removeFromStorage(url)) {
          markRemoved();
        }
        return;
      }
      if (addToStorage(url)) {
        markAdded();
      }
    };

    const img = document.createElement('img');
    img.src = thumbUrl;
    img.className = 'm3u8-thumb';
    img.onclick = handleToggle;
    img.onload = () => {
      pendingM3u8Urls.delete(url);
      m3u8Urls.add(url);
      appendRow(img);
      const count = document.getElementById('m3u8-count');
      if (count) count.textContent = String(m3u8Urls.size);
    };
    img.onerror = () => {
      // превью недоступно — показываем fallback-плитку, чтобы ссылка не терялась
      pendingM3u8Urls.delete(url);
      m3u8Urls.add(url);
      const fallback = document.createElement('div');
      fallback.className = 'm3u8-thumb m3u8-thumb-fallback';
      fallback.textContent = '?';
      fallback.title = url;
      fallback.onclick = handleToggle;
      appendRow(fallback);
      const count = document.getElementById('m3u8-count');
      if (count) count.textContent = String(m3u8Urls.size);
    };
    tdLink.appendChild(btnOpen);
  }

  // ---------- привязка к карточке пина ----------
  let lastHovered = null;
  document.addEventListener('mouseover', (e) => {
    lastHovered = e.target;
  }, { passive: true, capture: true });

  function getHoveredElement() {
    return lastHovered;
  }

  function findPinContainer(startEl) {
    if (!startEl) return null;
    let el = startEl;
    // попытка найти обёртку пина как можно выше:
    const isPinLike = (node) => {
      if (!node || node.nodeType !== 1) return false;
      // приоритетные атрибуты Pinterest
      if (node.matches('[data-test-pin-id], [data-pin-drag-id]')) return true;
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
    // приоритет: явный атрибут пина из DOM Pinterest
    const pinEl = container.closest('[data-test-pin-id]') || container.querySelector('[data-test-pin-id]');
    if (pinEl) return `pin:${pinEl.getAttribute('data-test-pin-id')}`;
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
    const pinKey = extractPinKey(pin);

    const title = pin ? (pin.getAttribute('aria-label') || pin.textContent?.trim().slice(0,60)) : '';
    addToPanel(url, title, pinKey);
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
        scanDurationBadges();
      }, 50);
    }
    history.pushState = function () { const r = push.apply(this, arguments); rerun(); return r; };
    history.replaceState = function () { const r = replace.apply(this, arguments); rerun(); return r; };
    window.addEventListener('popstate', rerun);
  }

  // ---------- старт ----------
  // патчи fetch/XHR ставим сразу (document-start), чтобы не потерять
  // запросы, которые Pinterest делает до DOMContentLoaded
  try {
    patchFetch();
    patchXHR();
  } catch (e) {
    console.error('[M3U8] patch error', e);
  }

  onReady(() => {
    try {
      ensurePanel();
      hookHistory();
      watchDurationBadges();
      log('M3U8 helper started');
    } catch (e) {
      console.error('[M3U8] init error', e);
    }
  });

})();
