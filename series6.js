// ═══════════════════════════════════════════════════════════
// SISTEMA INTEGRADO DE SERIES CON REPRODUCTOR
// ═══════════════════════════════════════════════════════════

const WATCHED_KEY = 'watched_' + SERIE.id;
let activeSeason = 0;
let currentEpisode = null;
let activeLang = 0;
let activeServer = 0;
let hlsInstance = null;
let wolfInstance = null;
let renderCount = 0;
let resumeToastShown = false;

// ── Utilidades ────────────────────────────────────────────
const $ = id => document.getElementById(id);

function getWatchedMap() {
    return JSON.parse(localStorage.getItem(WATCHED_KEY) || '{}');
}

const isWatched = (map, s, e) => !!(map.seasons?.[s]?.[e]);

const setWatched = (s, e, val) => {
    let map = getWatchedMap();
    if (!map.seasons) map.seasons = {};
    if (!map.seasons[s]) map.seasons[s] = {};
    if (val) map.seasons[s][e] = true;
    else delete map.seasons[s][e];
    localStorage.setItem(WATCHED_KEY, JSON.stringify(map));
};

function fmtTime(s) {
    s = Math.floor(s || 0);
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return m + ':' + ss;
}

// ── Progreso / continuar viendo ───────────────────────────
function resumeKey() {
    if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) return null;
    const langName = currentEpisode.langs[activeLang].name;
    return 'resume_' + SERIE.id + '_s' + activeSeason + '_e' + currentEpisode.num + '_' + langName;
}

function saveProgress(currentTime, duration) {
    const key = resumeKey();
    if (!key || !duration || currentTime < 5) return;
    if (currentTime / duration > 0.95) {
        localStorage.removeItem(key);
        return;
    }
    const time = Math.floor(currentTime);
    localStorage.setItem(key, String(time));
}

function getSavedTime() {
    const key = resumeKey();
    if (!key) return 0;
    const t = parseInt(localStorage.getItem(key) || '0', 10);
    return t > 5 ? t : 0;
}

function showResumeToast(savedTime, onResume, onDismiss) {
    if (resumeToastShown) return;
    resumeToastShown = true;
    const existing = $('vp-resume-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'vp-resume-overlay';
    overlay.innerHTML = `
      <div id="vp-resume-modal">
        <div class="vp-resume-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="vp-resume-title">Continuar viendo</div>
        <div class="vp-resume-sub">Quedaste en <strong>${fmtTime(savedTime)}</strong></div>
        <div class="vp-resume-btns">
          <button class="vp-resume-btn vp-resume-yes">Continuar</button>
          <button class="vp-resume-btn vp-resume-no">Desde el inicio</button>
        </div>
      </div>`;
    $('player-wrap').appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
    const dismissTimer = setTimeout(() => dismiss(true), 10000);
    function dismiss(doResume) {
        clearTimeout(dismissTimer);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 280);
        if (doResume) onResume();
        else onDismiss();
    }
    overlay.querySelector('.vp-resume-yes').addEventListener('click', () => dismiss(true));
    overlay.querySelector('.vp-resume-no').addEventListener('click', () => dismiss(false));
}

// ── Renderizado de temporadas y episodios ─────────────────
if (SERIE.seasons) {
    SERIE.seasons.sort((a, b) => (a.id || 0) - (b.id || 0));
}
const headerTitle = $('header-title');
if (headerTitle) headerTitle.textContent = SERIE.title;
document.title = SERIE.title;

function renderTabs() {
    const tabs = $('seasons-tabs');
    if (!tabs) return;
    tabs.innerHTML = SERIE.seasons.map((s, i) => {
        const name = s.label || `Temporada ${s.num}`;
        return `<button class="season-tab${i === activeSeason ? ' active' : ''}" data-i="${i}">${name}</button>`;
    }).join('');
    tabs.querySelectorAll('.season-tab').forEach(btn =>
        btn.addEventListener('click', () => {
            activeSeason = +btn.dataset.i;
            renderTabs();
            renderEpisodes(true);
        })
    );
}

function renderEpisodes(animate) {
    const map = getWatchedMap();
    const eps = SERIE.seasons[activeSeason].episodes;
    const list = $('episodes-list');
    if (!list) return;
    list.innerHTML = eps.map(ep => {
        const thumbStyle = ep.thumb ? `background-image:url('${ep.thumb}')` : `background:linear-gradient(135deg,#0a1628,#001a0d)`;
        const watched = isWatched(map, activeSeason, ep.num);
        return `<div class="ep-card" data-s="${activeSeason}" data-e="${ep.num}">
      <div class="ep-thumb">
        <div class="ep-thumb-img" style="${thumbStyle}"></div>
        <div class="ep-thumb-play">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" opacity="0.85"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        <div class="ep-thumb-num">EP ${ep.num}</div>
      </div>
      <div class="ep-body">
        <div class="ep-num">Episodio ${ep.num}</div>
        <div class="ep-title">${ep.title}</div>
        <div class="ep-duration">${ep.duration}</div>
        ${ep.synopsis ? `<div class="ep-synopsis">${ep.synopsis}</div>` : ''}
        <div class="ep-switch-row">
          <label class="ep-switch" data-s="${activeSeason}" data-e="${ep.num}">
            <input type="checkbox" ${watched ? 'checked' : ''}>
            <span class="ep-switch-track"></span>
            <span class="ep-switch-thumb"></span>
          </label>
          <span class="ep-switch-label${watched ? ' on' : ''}" id="lbl-${activeSeason}-${ep.num}">${watched ? 'Visto' : 'No visto'}</span>
        </div>
      </div>
    </div>`;
    }).join('');
    list.querySelectorAll('.ep-card').forEach(c =>
        c.addEventListener('click', e => {
            if (e.target.closest('.ep-switch')) return;
            const s = +c.dataset.s, epNum = +c.dataset.e;
            playEpisode(s, epNum);
        })
    );
    list.querySelectorAll('.ep-switch').forEach(sw =>
        sw.addEventListener('change', () => {
            const s = +sw.dataset.s, epNum = +sw.dataset.e;
            const val = sw.querySelector('input').checked;
            setWatched(s, epNum, val);
            const lbl = $(`lbl-${s}-${epNum}`);
            if (lbl) { lbl.textContent = val ? 'Visto' : 'No visto'; lbl.classList.toggle('on', val); }
        })
    );
    if (animate) {
        list.classList.remove('season-change');
        void list.offsetWidth;
        list.classList.add('season-change');
    }
}

function syncWatchedState(currentS, currentE) {
    if (localStorage.getItem('auto_watched') !== '1') return;
    SERIE.seasons.forEach((s, sIdx) => {
        s.episodes.forEach(e => {
            const isFuture = (sIdx > currentS) || (sIdx === currentS && e.num > currentE);
            const val = !isFuture;
            setWatched(sIdx, e.num, val);
            const input = document.querySelector(`.ep-switch[data-s="${sIdx}"][data-e="${e.num}"] input`);
            if (input) input.checked = val;
            const lbl = $(`lbl-${sIdx}-${e.num}`);
            if (lbl) { lbl.textContent = val ? 'Visto' : 'No visto'; lbl.classList.toggle('on', val); }
        });
    });
}

// ── Reproductor ───────────────────────────────────────────
function playEpisode(seasonIdx, epNum, animate = false) {
    activeSeason = seasonIdx;
    const eps = SERIE.seasons[seasonIdx].episodes;
    currentEpisode = eps.find(e => e.num === epNum);
    if (!currentEpisode || !currentEpisode.langs) { alert('Este episodio no tiene servidores disponibles'); return; }
    syncWatchedState(seasonIdx, epNum);
    if (!currentEpisode.langs[activeLang]) activeLang = 0;
    if (!currentEpisode.langs[activeLang]?.servers[activeServer]) activeServer = 0;
    resumeToastShown = false;
    $('player-section').style.display = 'flex';
    $('episodes-list').style.display = 'none';
    document.querySelector('.seasons-wrap').style.display = 'none';
    $('player-ep-title').textContent = `Ep. ${epNum} · ${currentEpisode.title}`;
    const prevBtn = $('btn-prev'), nextBtn = $('btn-next');
    const currentIdx = eps.findIndex(e => e.num === epNum);
    let prevEp = null, prevSeasonIdx = seasonIdx;
    if (currentIdx > 0) prevEp = eps[currentIdx - 1];
    else if (seasonIdx > 0) {
        const prevS = SERIE.seasons[seasonIdx - 1];
        if (prevS && prevS.episodes.length > 0) { prevEp = prevS.episodes[prevS.episodes.length - 1]; prevSeasonIdx = seasonIdx - 1; }
    }
    let nextEp = null, nextSeasonIdx = seasonIdx;
    if (currentIdx >= 0 && currentIdx < eps.length - 1) nextEp = eps[currentIdx + 1];
    else if (seasonIdx < SERIE.seasons.length - 1) {
        const nextS = SERIE.seasons[seasonIdx + 1];
        if (nextS && nextS.episodes.length > 0) { nextEp = nextS.episodes[0]; nextSeasonIdx = seasonIdx + 1; }
    }
    const isMovie = currentEpisode.type === 'movie';
    if (isMovie) { if (prevBtn) prevBtn.style.display = 'none'; if (nextBtn) nextBtn.style.display = 'none'; }
    else { if (prevBtn) prevBtn.style.display = ''; if (nextBtn) nextBtn.style.display = ''; prevBtn.disabled = !prevEp; nextBtn.disabled = !nextEp; }
    prevBtn.onclick = () => { if (prevEp) playEpisode(prevSeasonIdx, prevEp.num, true); };
    nextBtn.onclick = () => { if (nextEp) playEpisode(nextSeasonIdx, nextEp.num, true); };
    updateLabels(); renderPlayer(animate);
}

function closePlayer() {
    renderCount++; $('player-section').style.display = 'none'; $('episodes-list').style.display = 'flex'; document.querySelector('.seasons-wrap').style.display = 'block';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) { if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy(); wolfInstance = null; }
    const wrap = $('player-wrap'); if (wrap) wrap.innerHTML = '';
    currentEpisode = null;
}

function updateLabels() {
    if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) return;
    const lang = currentEpisode.langs[activeLang];
    if (!lang.servers || !lang.servers[activeServer]) return;
    $('btn-lang-label').textContent = lang.name;
    $('btn-srv-label').textContent = lang.servers[activeServer].name;
}

function openPicker(type) {
    const isLang = type === 'lang';
    const items = isLang ? currentEpisode.langs.map((l, i) => ({ label: l.name, idx: i })) : currentEpisode.langs[activeLang].servers.map((s, i) => ({ label: s.name, idx: i }));
    const current = isLang ? activeLang : activeServer;
    const sel = document.createElement('select');
    sel.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:0;left:0';
    items.forEach(it => { const opt = document.createElement('option'); opt.value = String(it.idx); opt.textContent = it.label; if (it.idx === current) opt.selected = true; sel.appendChild(opt); });
    document.body.appendChild(sel);
    sel.addEventListener('change', () => { const idx = +sel.value; if (isLang) { activeLang = idx; activeServer = 0; } else { activeServer = idx; } resumeToastShown = false; updateLabels(); renderPlayer(); sel.remove(); });
    sel.addEventListener('blur', () => setTimeout(() => sel.remove(), 300));
    try { sel.showPicker(); } catch { sel.focus(); sel.click(); }
}

function createLoadingOverlay(parent) {
    const el = document.createElement('div'); el.className = 'vp-loading';
    el.innerHTML = `<div class="vp-loading-ring"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg></div><span class="vp-loading-text">Cargando servidor...</span>`;
    parent.appendChild(el);
    return { hide() { el.classList.add('done'); setTimeout(() => el.remove(), 420); } };
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS_PROXIES = [
    url => { const base = SERIE.proxyUrl; if (!base) return null; return base.replace(/\/?$/, '/') + '?url=' + encodeURIComponent(url); },
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&user_agent=${encodeURIComponent(DESKTOP_UA)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function proxyFetch(url, timeoutMs) {
    const opts = timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {};
    const tryProxy = (idx) => {
        if (idx >= CORS_PROXIES.length) return Promise.reject(new Error('Proxies failed'));
        const proxyUrl = CORS_PROXIES[idx](url); if (!proxyUrl) return tryProxy(idx + 1);
        return fetch(proxyUrl, opts).then(r => { if (!r.ok) throw new Error(r.status); return r.json().catch(() => r.text().then(t => ({ contents: t }))); }).catch(() => tryProxy(idx + 1));
    };
    return tryProxy(0);
}

function isDirectVideo(url) { if (url.includes('pixeldrain.com')) return false; if (url.includes('zilla-networks.com')) return true; return /\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(url) || /[\/=](mp4|webm|ogg|m3u8)([\/\?&]|$)/i.test(url) || url.includes('/m3u8/'); }
function isHLS(url) { if (url.includes('pixeldrain.com')) return false; return /\.m3u8(\?.*)?$/i.test(url) || /[\/=]m3u8([\/\?&]|$)/i.test(url) || url.includes('/m3u8/'); }

function detectVideoType(url) {
    if (url.includes('pixeldrain.com')) return Promise.resolve('iframe');
    if (/\.(mp4|webm|ogg)(?:[\/\?&]|$)/i.test(url) || /[\/=](mp4|webm|ogg)(?:[\/\?&]|$)/i.test(url)) return Promise.resolve('mp4');
    if (/\.m3u8(?:[\/\?&]|$)/i.test(url) || /[\/=]m3u8(?:[\/\?&]|$)/i.test(url)) return Promise.resolve('hls');
    return proxyFetch(url, 5000).then(data => { const ct = (data.content_type || '').toLowerCase(); if (ct.includes('mpegurl') || ct.includes('m3u8')) return 'hls'; if (ct.includes('mp4') || ct.includes('video/')) return 'mp4'; const body = (data.contents || '').trim(); if (body.startsWith('#EXTM3U')) return 'hls'; return 'iframe'; }).catch(() => 'iframe');
}

function extractVideoUrl(code) {
    const patterns = [/\b(?:url|file|src|source|link|video)\s*[:=]\s*['"`](https?:\/\/[^'"`\s,}]{10,}\.(?:m3u8|mp4|webm|ogg)[^'"`\s]*)/i, /(https?:\/\/[^\s"'`<>]{10,}\.(?:m3u8|mp4|webm|ogg)(?:\?[^\s"'`<>]*)?)/i];
    for (let re of patterns) { const m = code.match(re); if (m && m[1] && !m[1].includes('pixeldrain.com')) return m[1]; }
    return null;
}

function resolveUrl(server) {
    const url = server.url; if (!url || (!server.deobfuscate && !/jkanime|playmudos|streamani/i.test(url))) return Promise.resolve(url);
    return Promise.race([proxyFetch(url).then(d => { const code = d.contents || ''; let found = extractVideoUrl(code); if (found) return found; return url; }).catch(() => url), new Promise(r => setTimeout(() => r(url), 10000))]);
}

function updateCast(url) { const b = $('btn-cast'); if (!url) { b.style.display = 'none'; return; } b.style.display = ''; b._castUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=${url.startsWith('https') ? 'https' : 'http'};package=com.instantbits.cast.webvideo;end`; }

function loadIframe(wrap, url, server, loader, requestId) {
    if (requestId && requestId !== renderCount) return;
    wrap.innerHTML = ''; const f = document.createElement('iframe'); f.id = 'player-frame'; 
    const cleanUrl = url ? url.trim() : ''; if (!cleanUrl) { loader.hide(); wrap.innerHTML = '<p>URL vacía</p>'; return; }
    f.src = cleanUrl; f.allowFullscreen = true; f.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#000';
    f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture'); f.setAttribute('scrolling', 'no'); 
    if (server && server.sandbox) f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-fullscreen allow-popups');
    wrap.appendChild(f); let done = false; f.onload = () => { done = true; loader.hide(); }; setTimeout(() => { if (!done) loader.hide(); }, 8000);
}

function buildVideoPlayer(wrap, url, poster, videoType, mainLoader, server, requestId) {
    if (requestId && requestId !== renderCount) return;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) { if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy(); wolfInstance = null; }
    wrap.innerHTML = ''; const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const container = document.createElement('div'); container.className = 'vp-wolf-wrap'; container.id = 'wolf-player-container'; wrap.appendChild(container);
    const vidLoader = createLoadingOverlay(container); let loaderHidden = false;
    function hideLoader() { if (!loaderHidden) { loaderHidden = true; vidLoader.hide(); if (mainLoader) mainLoader.hide(); } }
    setTimeout(hideLoader, 10000);
    if (typeof window.WolfPlayer !== 'undefined') {
        const wolfConfig = { src: url, poster: poster || '', autoplay: false, color: '#00E676', volume: 0.8 };
        if (videoType === 'hls' || isHLS(url)) wolfConfig.hlsConfig = { maxBufferLength: isMobile ? 20 : 60, maxMaxBufferLength: isMobile ? 40 : 120, maxBufferSize: isMobile ? 40 * 1000 * 1000 : 80 * 1000 * 1000, startLevel: isMobile ? 0 : -1, capLevelToPlayerSize: true, autoStartLoad: true, enableWorker: true, backBufferLength: isMobile ? 15 : 40 };
        wolfInstance = new window.WolfPlayer('#wolf-player-container', wolfConfig);
        setTimeout(hideLoader, 2000);
        let preloadAttempts = 0;
        const preloadIv = setInterval(() => {
            if (requestId && requestId !== renderCount) return clearInterval(preloadIv);
            const v = container.querySelector('video');
            if (v) { clearInterval(preloadIv); if (url.includes('pixeldrain.com')) v.setAttribute('referrerpolicy', 'no-referrer'); v.setAttribute('preload', 'auto'); if (!url.includes('.m3u8')) v.load(); }
            else if (++preloadAttempts > 40) clearInterval(preloadIv);
        }, 50);
        setTimeout(() => {
            if (requestId && requestId !== renderCount) return;
            const v = container.querySelector('video');
            if (v) {
                v.addEventListener('error', () => { if (requestId === renderCount && server && server.url) { wrap.innerHTML = ''; loadIframe(wrap, server.url, server, createLoadingOverlay(wrap), requestId); } else { hideLoader(); wrap.innerHTML = '<div class="player-placeholder"><p>Error de video</p></div>'; } });
                let saveInterval = null, resumeChecked = false;
                const checkResume = () => { if (requestId !== renderCount || resumeChecked) return; const saved = getSavedTime(); resumeChecked = true; if (saved > 30) showResumeToast(saved, () => { v.currentTime = saved; v.play(); }, () => v.play()); };
                checkResume(); const doSave = () => { if (requestId === renderCount && v.duration > 0) saveProgress(v.currentTime, v.duration); };
                v.addEventListener('loadedmetadata', checkResume); v.addEventListener('play', () => { if (requestId === renderCount && !saveInterval) saveInterval = setInterval(doSave, 3000); });
                v.addEventListener('pause', doSave); v.addEventListener('timeupdate', () => { if (requestId === renderCount && (!v._lastSave || Date.now() - v._lastSave > 5000)) { v._lastSave = Date.now(); doSave(); } });
                v.addEventListener('ended', () => { if (requestId === renderCount) { clearInterval(saveInterval); const key = resumeKey(); if (key) localStorage.removeItem(key); } });
                const introEnd = currentEpisode.introEnd;
                if (introEnd > 0) {
                    const skipBtn = document.createElement('button'); skipBtn.id = 'vp-skip-intro'; skipBtn.textContent = 'Omitir intro'; skipBtn.style.cssText = 'position:absolute;bottom:100px;right:20px;padding:8px 16px;background:rgba(0,230,118,0.9);color:#000;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;opacity:0;transition:opacity 0.3s;z-index:9999;pointer-events:auto'; container.appendChild(skipBtn);
                    skipBtn.addEventListener('click', () => { v.currentTime = introEnd; skipBtn.style.opacity = '0'; }); v.addEventListener('timeupdate', () => { skipBtn.style.opacity = (v.currentTime < introEnd && !v.paused) ? '1' : '0'; });
                }
            }
        }, 1000);
    } else {
        const video = document.createElement('video'); video.controls = true; video.preload = isMobile ? 'metadata' : 'auto'; video.poster = poster; video.playsInline = true; video.style.cssText = 'width:100%;height:100%;background:#000;object-fit:contain';
        if (videoType === 'hls' || isHLS(url)) { if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url; else if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) { const hls = new window.Hls({ maxBufferLength: isMobile ? 15 : 45, maxMaxBufferLength: isMobile ? 30 : 90 }); hls.loadSource(url); hls.attachMedia(video); hlsInstance = hls; } else video.src = url; } else video.src = url;
        container.appendChild(video); video.addEventListener('canplay', () => hideLoader(), { once: true });
    }
}

function renderPlayer(animate = false) {
    const wrap = $('player-wrap'); const myCount = ++renderCount;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) { if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy(); wolfInstance = null; }
    wrap.innerHTML = ''; wrap.classList.remove('loaded', 'switching'); if (animate) wrap.classList.add('switching');
    const loader = createLoadingOverlay(wrap);
    const server = currentEpisode.langs[activeLang].servers[activeServer];
    resolveUrl(server).then(resolved => {
        if (myCount !== renderCount) return;
        let url = typeof resolved === 'object' ? resolved.url : resolved; const poster = typeof resolved === 'object' ? resolved.poster : (currentEpisode.thumb || '');
        updateCast(url); if (!url) { loader.hide(); wrap.innerHTML = '<div class="player-placeholder"><p>Sin URL</p></div>'; wrap.classList.add('loaded'); return; }
        if (isDirectVideo(url)) buildVideoPlayer(wrap, url, poster, isHLS(url) ? 'hls' : 'mp4', loader, server, myCount);
        else if (/^https?:\/\//i.test(url)) detectVideoType(url).then(vt => { if (myCount === renderCount) { if (vt === 'hls' || vt === 'mp4') buildVideoPlayer(wrap, url, poster, vt, loader, server, myCount); else loadIframe(wrap, server.url, server, loader, myCount); } });
        else loadIframe(wrap, server.url, server, loader, myCount);
        requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('loaded')));
    });
}

(function () {
    const overlay = $('cfg-overlay'), sheet = $('cfg-sheet'), pill = $('cfg-autowatched-pill'), row = $('cfg-autowatched-row');
    let aw = localStorage.getItem('auto_watched') === '1'; function updatePill() { if (pill) pill.classList.toggle('active', aw); } updatePill();
    const cfgBtn = $('cfg-btn'); if (cfgBtn) cfgBtn.addEventListener('click', () => { overlay.style.background = 'rgba(0,0,0,0.7)'; overlay.style.pointerEvents = 'auto'; sheet.style.transform = 'scale(1)'; sheet.style.opacity = '1'; });
    function close() { if (overlay) { overlay.style.background = 'rgba(0,0,0,0)'; overlay.style.pointerEvents = 'none'; sheet.style.transform = 'scale(0.92)'; sheet.style.opacity = '0'; } }
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    if ($('cfg-close')) $('cfg-close').addEventListener('click', close);
    if (row) row.addEventListener('click', () => { aw = !aw; localStorage.setItem('auto_watched', aw ? '1' : '0'); updatePill(); });
})();

const closePlayerBtn = $('btn-close-player'); if (closePlayerBtn) closePlayerBtn.addEventListener('click', () => closePlayer());
const langBtn = $('btn-lang'); if (langBtn) langBtn.addEventListener('click', () => openPicker('lang'));
const srvBtn = $('btn-srv'); if (srvBtn) srvBtn.addEventListener('click', () => openPicker('srv'));
const castBtn = $('btn-cast'); if (castBtn) castBtn.addEventListener('click', () => { const server = currentEpisode.langs[activeLang].servers[activeServer]; if (server && server.url) { const castUrl = `intent://${server.url.replace(/^https?:\/\//, '')}#Intent;scheme=${server.url.startsWith('https') ? 'https' : 'http'};package=com.instantbits.cast.webvideo;end`; if (typeof window.openCastModal === 'function') window.openCastModal(castUrl); else window.location.href = castUrl; } });

renderTabs(); renderEpisodes(true);
if (localStorage.getItem('auto_watched') === '1') {
    const map = getWatchedMap(); let highestS = -1, highestE = -1;
    for (let s = SERIE.seasons.length - 1; s >= 0; s--) {
        const eps = SERIE.seasons[s].episodes;
        for (let i = eps.length - 1; i >= 0; i--) { if (isWatched(map, s, eps[i].num)) { highestS = s; highestE = eps[i].num; break; } }
        if (highestS !== -1) break;
    }
    if (highestS !== -1 && highestE !== -1) setTimeout(() => playEpisode(highestS, highestE), 150);
}

(function () {
    const o = $('report-modal-overlay'), b = $('report-modal-box'), cBtn = $('report-modal-close'), sBtn = $('report-send-btn'), st = $('report-status'), co = $('report-comment'), ts = $('report-type-select'), ls = $('report-lang-select'), ss = $('report-srv-select'), fv = $('report-form-view'), sv = $('report-success-view'), si = $('report-success-icon');
    function closeModal() { b.style.transform = 'scale(0.94)'; b.style.opacity = '0'; setTimeout(() => o.style.display = 'none', 220); }
    const rBtn = $('btn-report'); if (rBtn) rBtn.addEventListener('click', () => { if (!currentEpisode) return; ls.innerHTML = ''; (currentEpisode.langs || []).forEach((l, i) => { const opt = document.createElement('option'); opt.value = i; opt.textContent = l.name; if (i === activeLang) opt.selected = true; ls.appendChild(opt); }); function fS(li) { ss.innerHTML = ''; (currentEpisode.langs?.[li]?.servers || []).forEach((s, i) => { const opt = document.createElement('option'); opt.value = i; opt.textContent = s.name; if (li === activeLang && i === activeServer) opt.selected = true; ss.appendChild(opt); }); } fS(activeLang); ls.onchange = () => fS(+ls.value); ts.value = ''; co.value = ''; st.textContent = ''; fv.style.display = ''; sv.style.display = 'none'; si.style.opacity = '0'; o.style.display = 'flex'; requestAnimationFrame(() => { b.style.transform = 'scale(1)'; b.style.opacity = '1'; }); });
    if (cBtn) cBtn.addEventListener('click', closeModal); if (o) o.onclick = e => { if (e.target === o) closeModal(); };
    if (sBtn) sBtn.onclick = async () => { const cfg = window.REPORT_CONFIG || {}; if (!cfg.botToken || cfg.botToken === 'TU_BOT_TOKEN_AQUI') { st.style.color = '#ff5050'; st.textContent = 'Config error'; return; } if (!ts.value) { st.style.color = '#ff5050'; st.textContent = 'Select problem'; return; } const li = +ls.value, sidx = +ss.value, lang = currentEpisode.langs?.[li]?.name || '-', srv = currentEpisode.langs?.[li]?.servers?.[sidx]?.name || '-';
        const lines = [`🚨 *Nuevo reporte*`, `📺 *Serie:* \`${SERIE.title}\``, `📅 *Temp:* \`${activeSeason + 1}\``, `🎞 *Ep:* \`${currentEpisode.num}\``, `🌐 *Lang:* \`${lang}\``, `🖥 *Srv:* \`${srv}\``, `⚠️ *Prob:* \`${ts.value}\``, co.value.trim() ? `💬 *Msg:* \`${co.value.trim()}\`` : null].filter(Boolean).join('\n');
        sBtn.disabled = true; st.textContent = 'Enviando...'; try { const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.chatId, text: lines, parse_mode: 'Markdown', message_thread_id: cfg.topicId }) }); const d = await res.json(); if (d.ok) { fv.style.display = 'none'; sv.style.display = ''; si.style.opacity = '1'; setTimeout(closeModal, 2000); } else throw 1; } catch { st.style.color = '#ff5050'; st.textContent = 'Error'; } finally { sBtn.disabled = false; } };
})();
