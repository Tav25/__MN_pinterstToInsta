// ==UserScript==
// @name         Pinterest video link helper
// @namespace    https://your.namespace.example
// @version      0.6
// @description  Добавляет кнопку скачивания на видео-пины и собирает прямые ссылки в панель
// @match        https://www.pinterest.*/*
// @match        https://pinterest.com/*
// @match        https://www.pinterest.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/Tav25/__MN_pinterstToInsta/master/pinterest-to-insta.user.js
// @downloadURL  https://raw.githubusercontent.com/Tav25/__MN_pinterstToInsta/master/pinterest-to-insta.user.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'pinterest_video_links_v1';
  const SETTINGS_KEY = 'pinterest_video_settings_v1';
  const PIN_CACHE_KEY = 'pinterest_video_pin_cache_v1';
  const BUTTON_CLASS = 'pvlh-download-btn';

  const qualityOrder = ['V_1080P', 'V_720P', 'V_540P', 'V_360P', 'V_HLSV4', 'V_HLSV3'];
  const pinCache = new Map();
  const seenUrls = new Set();

  const storage = {
    get(key, fallback) {
      if (typeof GM_getValue === 'function') {
        return GM_getValue(key, fallback);
      }
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    },
    set(key, value) {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  function normalizeUrl(u) {
    try {
      const url = new URL(u, location.href);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((p) =>
        url.searchParams.delete(p)
      );
      return url.toString();
    } catch (e) {
      return String(u);
    }
  }

  function getHoveredElement() {
    const path = document.querySelectorAll(':hover');
    if (!path || !path.length) return null;
    return path[path.length - 1];
  }

  function loadQueue() {
    return storage.get(STORAGE_KEY, []);
  }

  function saveQueue(queue) {
    storage.set(STORAGE_KEY, queue);
  }

  function loadSettings() {
    return storage.get(SETTINGS_KEY, { autoCopy: false });
  }

  function saveSettings(settings) {
    storage.set(SETTINGS_KEY, settings);
  }

  function loadPinCache() {
    const raw = storage.get(PIN_CACHE_KEY, {});
    Object.entries(raw).forEach(([pinId, data]) => {
      if (data && data.url) {
        pinCache.set(pinId, data);
      }
    });
  }

  function savePinCache() {
    const obj = {};
    pinCache.forEach((value, key) => {
      obj[key] = value;
    });
    storage.set(PIN_CACHE_KEY, obj);
  }

  function ensurePanel() {
    if (document.getElementById('pvlh-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'pvlh-panel';
    panel.innerHTML = `
      <div id="pvlh-header">
        <div>Видео-ссылки: <span id="pvlh-count">0</span></div>
        <label class="pvlh-toggle">
          <input type="checkbox" id="pvlh-autocopy" />
          Автокопирование
        </label>
      </div>
      <div id="pvlh-list-wrap">
        <ul id="pvlh-list"></ul>
      </div>
      <div id="pvlh-actions">
        <button id="pvlh-copy" type="button">Copy all</button>
        <button id="pvlh-export" type="button">Export .txt</button>
        <button id="pvlh-remove" type="button">Remove last</button>
        <button id="pvlh-clear" type="button">Clear</button>
      </div>
      <div id="pvlh-toast" aria-live="polite"></div>
    `;
    const css = document.createElement('style');
    css.textContent = `
      #pvlh-panel {
        position: fixed;
        right: 12px;
        top: 12px;
        width: 320px;
        z-index: 99999;
        background: #0d3b66;
        color: #faf0ca;
        border-radius: 10px;
        box-shadow: 0 6px 18px rgba(0,0,0,.35);
        font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
      }
      #pvlh-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: 600;
      }
      .pvlh-toggle {
        display: flex;
        gap: 6px;
        align-items: center;
        font-weight: 500;
      }
      #pvlh-list-wrap {
        min-height: 140px;
        max-height: 35vh;
        background: #082946;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.2);
        overflow: auto;
        padding: 8px;
      }
      #pvlh-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 11px;
      }
      #pvlh-list li {
        padding: 6px 8px;
        border-radius: 6px;
        background: rgba(255,255,255,0.06);
        word-break: break-all;
      }
      #pvlh-list a {
        color: #faf0ca;
        text-decoration: none;
      }
      #pvlh-list a:hover {
        text-decoration: underline;
      }
      #pvlh-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      #pvlh-actions button {
        border: none;
        border-radius: 6px;
        padding: 6px 8px;
        background: #f4d35e;
        color: #0d3b66;
        cursor: pointer;
        font-weight: 600;
      }
      #pvlh-actions button:hover {
        background: #ee964b;
      }
      #pvlh-toast {
        min-height: 16px;
        font-size: 11px;
        color: #f95738;
      }
      .${BUTTON_CLASS} {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 10;
        background: rgba(13,59,102,0.9);
        color: #faf0ca;
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 6px;
        padding: 4px 6px;
        font-size: 11px;
        cursor: pointer;
      }
      .${BUTTON_CLASS}[data-loading="true"] {
        opacity: 0.6;
        cursor: progress;
      }
    `;
    document.documentElement.appendChild(css);
    document.documentElement.appendChild(panel);

    const settings = loadSettings();
    const autoCopy = panel.querySelector('#pvlh-autocopy');
    autoCopy.checked = Boolean(settings.autoCopy);
    autoCopy.addEventListener('change', () => {
      settings.autoCopy = autoCopy.checked;
      saveSettings(settings);
    });

    panel.querySelector('#pvlh-copy').addEventListener('click', () => {
      copyAllLinks();
    });
    panel.querySelector('#pvlh-export').addEventListener('click', () => {
      exportLinks();
    });
    panel.querySelector('#pvlh-clear').addEventListener('click', () => {
      clearLinks();
    });
    panel.querySelector('#pvlh-remove').addEventListener('click', () => {
      removeLastLink();
    });

    renderQueue();
  }

  function showToast(message) {
    const toast = document.getElementById('pvlh-toast');
    if (!toast) return;
    toast.textContent = message;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.textContent = '';
    }, 2500);
  }

  function renderQueue() {
    const panel = document.getElementById('pvlh-panel');
    if (!panel) return;
    const queue = loadQueue();
    const list = panel.querySelector('#pvlh-list');
    const count = panel.querySelector('#pvlh-count');
    count.textContent = String(queue.length);
    if (!list) return;
    list.innerHTML = '';
    queue.forEach((item) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = item.url;
      link.textContent = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      li.appendChild(link);
      list.appendChild(li);
    });
  }

  function addLinkToQueue(entry) {
    const queue = loadQueue();
    const exists = queue.some((item) => item.url === entry.url || item.pinId === entry.pinId);
    if (exists) {
      showToast('Уже в списке');
      return false;
    }
    queue.unshift(entry);
    saveQueue(queue);
    renderQueue();

    const settings = loadSettings();
    if (settings.autoCopy) {
      copyAllLinks();
    }
    showToast(`Добавлено: ${entry.quality || 'video'}`);
    return true;
  }

  function clearLinks() {
    saveQueue([]);
    renderQueue();
    showToast('Список очищен');
  }

  function removeLastLink() {
    const queue = loadQueue();
    queue.shift();
    saveQueue(queue);
    renderQueue();
  }

  function copyAllLinks() {
    const queue = loadQueue();
    const value = queue.map((item) => item.url).join('\n');
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(value);
      showToast('Скопировано');
      return;
    }
    navigator.clipboard?.writeText(value).then(
      () => showToast('Скопировано'),
      () => showToast('Не удалось скопировать')
    );
  }

  function exportLinks() {
    const queue = loadQueue();
    const blob = new Blob([queue.map((item) => item.url).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pinterest-video-links.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function findPinContainer(startEl) {
    if (!startEl) return null;
    let el = startEl;
    const isPinLike = (node) => {
      if (!node || node.nodeType !== 1) return false;
      if (node.matches('div[data-test-id*="pin"], div[data-test-id*="Pin"], div[class*="Pin"]')) return true;
      if (node.matches('[role="listitem"]')) return true;
      if (node.querySelector && node.querySelector('a[href*="/pin/"]')) return true;
      return false;
    };
    while (el && el !== document.documentElement) {
      if (isPinLike(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function extractPinId(container) {
    if (!container) return null;
    const attr = container.getAttribute('data-test-pin-id');
    if (attr) return attr;
    const candidate = container.querySelector('[data-test-pin-id]');
    if (candidate) return candidate.getAttribute('data-test-pin-id');
    const link = container.querySelector('a[href*="/pin/"]');
    if (link) {
      const match = link.href.match(/\/pin\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function extractVideoFromContainer(container) {
    if (!container) return null;
    const video = container.querySelector('video');
    if (video) {
      const source = video.currentSrc || video.src;
      if (source) return source;
      const sourceEl = video.querySelector('source');
      if (sourceEl?.src) return sourceEl.src;
    }
    return null;
  }

  function isVideoPin(container) {
    if (!container) return false;
    if (container.querySelector('video')) return true;
    if (container.querySelector('[data-test-id*="video"], [data-test-id*="Video"]')) return true;
    return false;
  }

  function addDownloadButton(container) {
    if (!container || container.querySelector(`.${BUTTON_CLASS}`)) return;
    if (!isVideoPin(container)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.textContent = 'Скачать';
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const pinId = extractPinId(container);
      if (!pinId) {
        showToast('Не найден pin-id');
        return;
      }
      await handleDownload(pinId, btn, container);
    });

    const style = window.getComputedStyle(container);
    if (style.position === 'static') {
      container.style.position = 'relative';
    }
    container.appendChild(btn);
  }

  function isCmfvUrl(url) {
    return /\.cmfv(\?|$)/i.test(url);
  }

  function isVideoUrl(url) {
    return /\.(mp4|m3u8|cmfv)(\?|$)/i.test(url);
  }

  function attachSniffedUrlToPin(url, container) {
    const normalized = normalizeUrl(url);
    if (seenUrls.has(normalized)) return;
    seenUrls.add(normalized);

    const pinId = extractPinId(container);
    const entry = { url: normalized, quality: 'sniffed', pinId: pinId || null };
    if (pinId) {
      pinCache.set(pinId, entry);
      savePinCache();
    }
    addLinkToQueue(entry);
  }

  function chooseBestVideo(videoList) {
    if (!videoList) return null;
    for (const quality of qualityOrder) {
      if (videoList[quality]?.url) {
        return { url: videoList[quality].url, quality };
      }
    }
    const entries = Object.values(videoList).filter((item) => item?.url);
    if (entries.length) return { url: entries[0].url, quality: 'video' };
    return null;
  }

  function choosePreferredVideo(videoList) {
    if (!videoList) return null;
    for (const quality of qualityOrder) {
      const url = videoList[quality]?.url;
      if (url && isCmfvUrl(url)) {
        return { url, quality: `${quality} (cmfv)` };
      }
    }
    const entries = Object.values(videoList).filter((item) => item?.url);
    for (const entry of entries) {
      if (isCmfvUrl(entry.url)) {
        return { url: entry.url, quality: 'cmfv' };
      }
    }
    return chooseBestVideo(videoList);
  }

  function extractVideoFromPinData(data) {
    if (!data) return null;
    const videoList = data.videos?.video_list;
    const direct = choosePreferredVideo(videoList);
    if (direct) return direct;
    return null;
  }

  async function fetchPinResource(pinId) {
    const data = {
      options: { id: pinId, field_set_key: 'detailed' },
      context: {},
    };
    const url = `/resource/PinResource/get/?data=${encodeURIComponent(JSON.stringify(data))}&source_url=${encodeURIComponent(`/pin/${pinId}/`)}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`PinResource ${response.status}`);
    }
    const payload = await response.json();
    return payload?.resource_response?.data;
  }

  function findVideoListInObject(source, pinId) {
    const visited = new Set();
    const stack = [source];
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (current.id === pinId && current.videos?.video_list) {
        return current.videos.video_list;
      }
      if (current.videos?.video_list) {
        return current.videos.video_list;
      }

      if (Array.isArray(current)) {
        current.forEach((item) => stack.push(item));
      } else {
        Object.values(current).forEach((value) => stack.push(value));
      }
    }
    return null;
  }

  async function fetchPinPageVideo(pinId) {
    const response = await fetch(`/pin/${pinId}/`, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Pin page ${response.status}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const script = doc.querySelector('#__PWS_DATA__');
    if (!script) return null;
    const data = JSON.parse(script.textContent);
    const videoList = findVideoListInObject(data, pinId);
    return choosePreferredVideo(videoList);
  }

  async function resolveVideoUrl(pinId) {
    if (pinCache.has(pinId)) return pinCache.get(pinId);

    try {
      const pinData = await fetchPinResource(pinId);
      const video = extractVideoFromPinData(pinData);
      if (video?.url) {
        const normalized = normalizeUrl(video.url);
        const entry = { url: normalized, quality: video.quality, pinId };
        pinCache.set(pinId, entry);
        savePinCache();
        return entry;
      }
    } catch (error) {
      // fallback below
    }

    const fallbackVideo = await fetchPinPageVideo(pinId);
    if (fallbackVideo?.url) {
      const normalized = normalizeUrl(fallbackVideo.url);
      const entry = { url: normalized, quality: fallbackVideo.quality, pinId };
      pinCache.set(pinId, entry);
      savePinCache();
      return entry;
    }

    return null;
  }

  async function handleDownload(pinId, button, container) {
    button.dataset.loading = 'true';
    try {
      let entry = await resolveVideoUrl(pinId);
      if (entry && !isVideoUrl(entry.url)) {
        entry = null;
      }
      if (!entry) {
        const fallbackUrl = extractVideoFromContainer(container);
        if (fallbackUrl) {
          const normalized = normalizeUrl(fallbackUrl);
          if (isVideoUrl(normalized)) {
            entry = { url: normalized, quality: 'dom', pinId };
          }
        }
      }
      if (!entry) {
        const cached = pinCache.get(pinId);
        if (cached && isVideoUrl(cached.url)) {
          entry = cached;
        }
      }
      if (!entry) {
        showToast('Ссылка не найдена');
        return;
      }
      addLinkToQueue(entry);
    } catch (error) {
      showToast('Ошибка получения видео');
    } finally {
      button.dataset.loading = 'false';
    }
  }

  function scanAndAttachButtons(root) {
    const candidates = root.querySelectorAll('div[data-test-id*="pin"], div[data-test-id*="Pin"], [role="listitem"]');
    candidates.forEach((node) => {
      if (node.dataset.pvlhProcessed === 'true') return;
      node.dataset.pvlhProcessed = 'true';
      addDownloadButton(node);
    });
  }

  function observePins() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('div[data-test-id*="pin"], div[data-test-id*="Pin"], [role="listitem"]')) {
            addDownloadButton(node);
            node.dataset.pvlhProcessed = 'true';
          }
          if (node.querySelectorAll) {
            scanAndAttachButtons(node);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function handleSniffedUrl(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (seenUrls.has(url)) return;
    const hovered = getHoveredElement();
    const container = findPinContainer(hovered || document.activeElement);
    attachSniffedUrlToPin(url, container);
  }

  function patchFetch() {
    if (window._pvlh_fetch_patched) return;
    window._pvlh_fetch_patched = true;

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const req = args[0];
        const url = req?.url ? req.url : String(req);
        if (isVideoUrl(url)) {
          handleSniffedUrl(url);
        }
      } catch (e) {
        // ignore
      }
      return origFetch.apply(this, args).then((res) => {
        try {
          const url = res.url || (args[0] && args[0].url) || String(args[0]);
          if (isVideoUrl(url)) {
            handleSniffedUrl(url);
          }
        } catch (e) {
          // ignore
        }
        return res;
      });
    };
  }

  function patchXHR() {
    if (window._pvlh_xhr_patched) return;
    window._pvlh_xhr_patched = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      this._pvlh_url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      try {
        const url = this._pvlh_url;
        if (url && isVideoUrl(url)) {
          handleSniffedUrl(url);
        }
      } catch (e) {
        // ignore
      }
      return origSend.apply(this, arguments);
    };
  }

  function onReady(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  }

  function hookHistory() {
    const push = history.pushState;
    const replace = history.replaceState;
    function rerun() {
      setTimeout(() => {
        ensurePanel();
        scanAndAttachButtons(document);
      }, 50);
    }
    history.pushState = function () {
      const r = push.apply(this, arguments);
      rerun();
      return r;
    };
    history.replaceState = function () {
      const r = replace.apply(this, arguments);
      rerun();
      return r;
    };
    window.addEventListener('popstate', rerun);
  }

  onReady(() => {
    try {
      loadPinCache();
      ensurePanel();
      scanAndAttachButtons(document);
      observePins();
      patchFetch();
      patchXHR();
      hookHistory();
    } catch (error) {
      console.error('[PVLH] init error', error);
    }
  });
})();
