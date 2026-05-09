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
        const thumbStyle = ep.thumb
            ? `background-image:url('${ep.thumb}')`
            : `background:linear-gradient(135deg,#0a1628,#001a0d)`;
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
            const s = +sw.dataset.s, ep = +sw.dataset.e;
            const val = sw.querySelector('input').checked;
            setWatched(s, ep, val);
            const lbl = $(`lbl-${s}-${ep}`);
            if (lbl) { lbl.textContent = val ? 'Visto' : 'No visto'; lbl.classList.toggle('on', val); }
        })
    );

    if (animate) {
        list.classList.remove('season-change');
        void list.offsetWidth;
        list.classList.add('season-change');
    }
}

// ── Reproductor ───────────────────────────────────────────
function playEpisode(seasonIdx, epNum, animate = false) {
    activeSeason = seasonIdx;
    const eps = SERIE.seasons[seasonIdx].episodes;
    currentEpisode = eps.find(e => e.num === epNum);

    if (!currentEpisode || !currentEpisode.langs) {
        alert('Este episodio no tiene servidores disponibles');
        return;
    }

    // Marcar como visto si está activado
    if (localStorage.getItem('auto_watched') === '1') {
        setWatched(seasonIdx, epNum, true);
        const input = document.querySelector(`.ep-switch[data-s="${seasonIdx}"][data-e="${epNum}"] input`);
        if (input) input.checked = true;
        const lbl = $(`lbl-${seasonIdx}-${epNum}`);
        if (lbl) { lbl.textContent = 'Visto'; lbl.classList.add('on'); }
    }

    // Mantener idioma y servidor actual si existen en el nuevo episodio
    if (!currentEpisode.langs[activeLang]) {
        activeLang = 0;
    }
    if (!currentEpisode.langs[activeLang]?.servers[activeServer]) {
        activeServer = 0;
    }
    resumeToastShown = false;

    // Mostrar reproductor
    $('player-section').style.display = 'flex';
    $('episodes-list').style.display = 'none';
    document.querySelector('.seasons-wrap').style.display = 'none';

    // Actualizar título
    $('player-ep-title').textContent = `Ep. ${epNum} · ${currentEpisode.title}`;

    // Configurar botones de navegación con lógica de temporadas
    const prevBtn = $('btn-prev');
    const nextBtn = $('btn-next');

    // Encontrar índice del episodio actual en el array
    const currentIdx = eps.findIndex(e => e.num === epNum);

    // Buscar episodio anterior
    let prevEp = null;
    let prevSeasonIdx = seasonIdx;

    if (currentIdx > 0) {
        // Hay episodio anterior en esta temporada
        prevEp = eps[currentIdx - 1];
    } else if (seasonIdx > 0) {
        // Buscar en la temporada anterior
        const prevSeason = SERIE.seasons[seasonIdx - 1];
        if (prevSeason && prevSeason.episodes.length > 0) {
            prevEp = prevSeason.episodes[prevSeason.episodes.length - 1];
            prevSeasonIdx = seasonIdx - 1;
        }
    }

    // Buscar episodio siguiente
    let nextEp = null;
    let nextSeasonIdx = seasonIdx;

    if (currentIdx >= 0 && currentIdx < eps.length - 1) {
        // Hay episodio siguiente en esta temporada
        nextEp = eps[currentIdx + 1];
    } else if (seasonIdx < SERIE.seasons.length - 1) {
        // Buscar en la siguiente temporada
        const nextSeason = SERIE.seasons[seasonIdx + 1];
        if (nextSeason && nextSeason.episodes.length > 0) {
            nextEp = nextSeason.episodes[0];
            nextSeasonIdx = seasonIdx + 1;
        }
    }

    // Configurar botones
    const isMovie = currentEpisode.type === 'movie';

    if (isMovie) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        // Si hay un divisor o barra, también podríamos ocultarla si tuviera ID/clase
    } else {
        if (prevBtn) prevBtn.style.display = '';
        if (nextBtn) nextBtn.style.display = '';
        prevBtn.disabled = !prevEp;
        nextBtn.disabled = !nextEp;
    }

    prevBtn.onclick = () => {
        if (prevEp) playEpisode(prevSeasonIdx, prevEp.num, true);
    };

    nextBtn.onclick = () => {
        if (nextEp) playEpisode(nextSeasonIdx, nextEp.num, true);
    };

    updateLabels();
    renderPlayer(animate);
}

function closePlayer() {
    $('player-section').style.display = 'none';
    $('episodes-list').style.display = 'flex';
    document.querySelector('.seasons-wrap').style.display = 'block';

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) {
        if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy();
        wolfInstance = null;
    }

    // Detener reproducción al cerrar
    const wrap = $('player-wrap');
    if (wrap) wrap.innerHTML = '';

    currentEpisode = null;
}

function updateLabels() {
    if (!currentEpisode) return;
    if (!currentEpisode.langs || !currentEpisode.langs[activeLang]) {
        console.error('Error: idioma no disponible', activeLang);
        return;
    }
    const lang = currentEpisode.langs[activeLang];
    if (!lang.servers || !lang.servers[activeServer]) {
        console.error('Error: servidor no disponible', activeServer);
        return;
    }
    $('btn-lang-label').textContent = lang.name;
    $('btn-srv-label').textContent = lang.servers[activeServer].name;
}

function openPicker(type) {
    const isLang = type === 'lang';
    const items = isLang
        ? currentEpisode.langs.map((l, i) => ({ label: l.name, idx: i }))
        : currentEpisode.langs[activeLang].servers.map((s, i) => ({ label: s.name, idx: i }));
    const current = isLang ? activeLang : activeServer;

    const sel = document.createElement('select');
    sel.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:0;left:0';
    items.forEach(it => {
        const opt = document.createElement('option');
        opt.value = String(it.idx);
        opt.textContent = it.label;
        if (it.idx === current) opt.selected = true;
        sel.appendChild(opt);
    });
    document.body.appendChild(sel);

    sel.addEventListener('change', () => {
        const idx = +sel.value;
        if (isLang) { activeLang = idx; activeServer = 0; } else { activeServer = idx; }
        resumeToastShown = false;
        updateLabels();
        renderPlayer();
        sel.remove();
    });
    sel.addEventListener('blur', () => setTimeout(() => sel.remove(), 300));
    try { sel.showPicker(); } catch { sel.focus(); sel.click(); }
}

function createLoadingOverlay(parent) {
    const el = document.createElement('div');
    el.className = 'vp-loading';
    el.innerHTML = `
      <div class="vp-loading-ring">
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg>
      </div>
      <span class="vp-loading-text">Cargando servidor...</span>`;
    parent.appendChild(el);
    return {
        hide() {
            el.classList.add('done');
            setTimeout(() => el.remove(), 420);
        }
    };
}

// ── Utilidades de detección y desofuscación ──────────────
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_PROXIES = [
    url => {
        const base = SERIE.proxyUrl;
        if (!base) return null;
        return base.replace(/\/?$/, '/') + '?url=' + encodeURIComponent(url);
    },
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&user_agent=${encodeURIComponent(DESKTOP_UA)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function proxyFetch(url, timeoutMs) {
    const opts = timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {};
    const tryProxy = (idx) => {
        if (idx >= CORS_PROXIES.length) return Promise.reject(new Error('Todos los proxies fallaron'));
        const proxyUrl = CORS_PROXIES[idx](url);
        if (!proxyUrl) {
            console.warn(`⚠️ Proxy ${idx + 1} omitido (sin URL) → siguiente...`);
            return tryProxy(idx + 1);
        }
        return fetch(proxyUrl, opts)
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json().catch(() => r.text().then(t => ({ contents: t })));
            })
            .catch(e => {
                console.warn(`⚠️ Proxy ${idx + 1} falló:`, e.message, '→ intentando siguiente...');
                return tryProxy(idx + 1);
            });
    };
    return tryProxy(0);
}

function isDirectVideo(url) {
    if (url.includes('pixeldrain.com')) return false;
    if (url.includes('zilla-networks.com')) return true;
    return /\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(url) ||
        /[\/=](mp4|webm|ogg|m3u8)([\/\?&]|$)/i.test(url) ||
        url.includes('/m3u8/');
}

function isHLS(url) {
    if (url.includes('pixeldrain.com')) return false;
    return /\.m3u8(\?.*)?$/i.test(url) ||
        /[\/=]m3u8([\/\?&]|$)/i.test(url) ||
        url.includes('/m3u8/');
}

function detectVideoType(url) {
    if (url.includes('pixeldrain.com')) return Promise.resolve('iframe');

    // Si la URL ya tiene extensión reconocible, no hace falta fetch
    if (/\.(mp4|webm|ogg)(?:[\/\?&]|$)/i.test(url) || /[\/=](mp4|webm|ogg)(?:[\/\?&]|$)/i.test(url)) return Promise.resolve('mp4');
    if (/\.m3u8(?:[\/\?&]|$)/i.test(url) || /[\/=]m3u8(?:[\/\?&]|$)/i.test(url)) return Promise.resolve('hls');

    // Solo tratar como iframe directamente si tiene palabras clave MUY específicas de embeds
    // y no parece tener una extensión o segmento de video
    if (/\/(play|embed|player|watch)\//i.test(url) && !/[\/=](mp4|webm|m3u8)(?:[\/\?&]|$)/i.test(url) && !/\.(mp4|webm|m3u8)/i.test(url)) {
        return Promise.resolve('iframe');
    }

    // Intentar HEAD request directo (sin proxy) para ver Content-Type
    const referPolicy = url.includes('pixeldrain.com') ? 'no-referrer' : 'strict-origin-when-cross-origin';
    return fetch(url, { method: 'HEAD', mode: 'no-cors', referrerPolicy: referPolicy })
        .then(() => {
            return proxyFetch(url, 5000)
                .then(data => {
                    const ct = (data.content_type || '').toLowerCase();
                    if (ct.includes('mpegurl') || ct.includes('x-mpegurl') || ct.includes('m3u8')) return 'hls';
                    if (ct.includes('mp4') || ct.includes('video/') || ct.includes('octet-stream')) {
                        const body = (data.contents || '').trimStart();
                        if (body.startsWith('#EXTM3U')) return 'hls';
                        if (body.toLowerCase().startsWith('<html') || body.toLowerCase().startsWith('<!doctype')) return 'iframe';
                        return 'mp4';
                    }
                    return 'iframe';
                });
        })
        .catch(() => 'iframe'); // Si falla cualquier fetch → tratar como iframe
}

function extractVideoUrl(code) {
    if (!code) return null;
    const patterns = [
        /\b(?:url|file|src|source|link|video)\s*[:=]\s*['"`](https?:\/\/[^'"`\s,}]{10,}\.(?:m3u8|mp4|webm|ogg)[^'"`\s]*)/i,
        /(https?:\/\/[^\s"'`<>]{10,}\.(?:m3u8|mp4|webm|ogg)(?:\?[^\s"'`<>]*)?)/i,
        /["']?(?:file|src|source|hls|stream|video|link)["']?\s*[=:]\s*["'`](https?:\/\/[^"'` \s,}]{10,}(?!\.(?:js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|otf|map|json)(?:\?|$))[^"'` \s,}]*)/i,
        /data-(?:src|url|video)=["'](https?:\/\/[^"']{10,}\.(?:m3u8|mp4|webm|ogg)[^"']*)["']/i,
    ];

    for (let re of patterns) {
        // Convert to global exactly to search all matches, not just the first abort if pixeldrain
        const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        const matches = [...code.matchAll(globalRe)];
        for (const m of matches) {
            if (m && m[1] && !m[1].includes('pixeldrain.com')) {
                return m[1];
            }
        }
    }
    return null;
}

function tryUnpack(code) {
    const packed = unpackPACKED(code);
    if (packed) return packed;
    const b64m = code.match(/eval\s*\(\s*atob\s*\(\s*['"`]([\s\S]+?)['"`]\s*\)\s*\)/);
    if (b64m) { try { return atob(b64m[1]); } catch { } }
    const urim = code.match(/eval\s*\(\s*decodeURIComponent\s*\(\s*['"`]([\s\S]+?)['"`]\s*\)\s*\)/);
    if (urim) { try { return decodeURIComponent(urim[1]); } catch { } }
    const strm = code.match(/^[\s]*eval\s*\(\s*(['"`])([\s\S]*)\1\s*\)\s*;?\s*$/);
    if (strm) return strm[2]
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/.test(code))
        return code
            .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return null;
}

function unpackPACKED(code) {
    const m = code.match(/eval\s*\(\s*function\s*\(p,a,c,k,e[^)]*\)\s*\{[\s\S]*?\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'[\s\S]*?\)\s*\)/);
    if (!m) return null;
    try {
        const p = m[1], a = parseInt(m[2]), c = parseInt(m[3]), k = m[4].split('|');
        let result = p;
        for (let i = c - 1; i >= 0; i--) {
            if (k[i]) result = result.replace(new RegExp('\\b' + i.toString(a) + '\\b', 'g'), k[i]);
        }
        return result;
    } catch { return null; }
}

function resolveUrl(server) {
    const url = server.url;
    if (!url) return Promise.resolve('');
    const isKnownObfuscated =
        url.includes('jkanime.net') ||
        url.includes('playmudos.com') ||
        url.includes('streamani.me');
    if (!server.deobfuscate && !isKnownObfuscated) return Promise.resolve(url);

    console.group('🔍 resolveUrl:', url);
    console.log('⏳ Fetching via proxy...');

    const timeout = new Promise(resolve => setTimeout(() => {
        console.warn('⏱️ Timeout — mostrando iframe directamente');
        console.groupEnd();
        resolve(url);
    }, 10000));

    const extract = proxyFetch(url)
        .then(data => {
            let code = data.contents || '';
            console.log('📄 HTML recibido:', code.length, 'chars');
            if (!code) { console.warn('⚠️ HTML vacío'); console.groupEnd(); return url; }

            let found = extractVideoUrl(code);
            if (found) { console.log('✅ Capa 1 (HTML crudo):', found); console.groupEnd(); return found; }

            const scripts = [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
            for (let si = 0; si < scripts.length; si++) {
                found = extractVideoUrl(scripts[si][1]);
                if (found) { console.log(`✅ Capa 2 (script #${si + 1}):`, found); console.groupEnd(); return found; }
            }

            let current = code;
            for (let i = 0; i < 10; i++) {
                const decoded = tryUnpack(current);
                if (!decoded || decoded === current) break;
                current = decoded;
                found = extractVideoUrl(current);
                if (found) { console.log(`✅ Capa 3 (desofuscado ${i + 1}):`, found); console.groupEnd(); return found; }
            }

            for (let si = 0; si < scripts.length; si++) {
                let sc = scripts[si][1];
                for (let i = 0; i < 8; i++) {
                    const decoded = tryUnpack(sc);
                    if (!decoded || decoded === sc) break;
                    sc = decoded;
                    found = extractVideoUrl(sc);
                    if (found) { console.log(`✅ Capa 4 (script #${si + 1} capa ${i + 1}):`, found); console.groupEnd(); return found; }
                }
            }

            console.warn('⚠️ No se encontró URL — usando iframe');
            console.groupEnd();
            return url;
        })
        .catch(e => {
            console.error('❌ Error fetch:', e.message, '— usando iframe');
            console.groupEnd();
            return url;
        });

    return Promise.race([extract, timeout]);
}

function updateCast(url) {
    const castBtn = $('btn-cast');
    if (!url) { castBtn.style.display = 'none'; return; }
    castBtn.style.display = '';
    castBtn._castUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=${url.startsWith('https') ? 'https' : 'http'};package=com.instantbits.cast.webvideo;end`;
}

function loadIframe(wrap, url, server, loader, requestId) {
    if (requestId && requestId !== renderCount) return;

    wrap.innerHTML = '';
    const f = document.createElement('iframe');
    f.id = 'player-frame';
    f.src = url;
    f.allowFullscreen = true;
    f.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#000';
    f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    f.setAttribute('scrolling', 'no');
    if (server && server.sandbox) {
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-fullscreen');
    }
    const iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'position:relative;width:100%;height:100%';

    // Botón pantalla completa solo para iframes de jkanime
    if (/jkanime\.net/i.test(url)) {
        const iconExpand = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
        const iconCollapse = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;
        const fsBtn = document.createElement('button');
        fsBtn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:10;background:rgba(0,0,0,0.7);border:none;color:#fff;border-radius:8px;height:36px;padding:0 12px;display:flex;align-items:center;gap:6px;cursor:pointer;backdrop-filter:blur(4px);transition:background 0.2s;font-size:12px;font-weight:700;font-family:inherit;white-space:nowrap';
        const updateBtn = () => {
            const isFs = !!document.fullscreenElement;
            fsBtn.innerHTML = (isFs ? iconCollapse : iconExpand) + `<span>${isFs ? 'Salir' : 'Pantalla completa'}</span>`;
        };
        updateBtn();
        fsBtn.addEventListener('mouseenter', () => fsBtn.style.background = 'rgba(0,230,118,0.85)');
        fsBtn.addEventListener('mouseleave', () => fsBtn.style.background = 'rgba(0,0,0,0.7)');
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                const el = iframeWrap;
                if (el.requestFullscreen) el.requestFullscreen();
                else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
        });
        document.addEventListener('fullscreenchange', updateBtn);
        document.addEventListener('webkitfullscreenchange', updateBtn);
        iframeWrap.appendChild(fsBtn);
    }

    // Bloqueador de popups
    const adBlocker = document.createElement('div');
    adBlocker.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none';
    const origOpen = window.open;
    window.open = () => null;

    iframeWrap.appendChild(f);
    iframeWrap.appendChild(adBlocker);
    wrap.appendChild(iframeWrap);

    f.addEventListener('load', () => {
        loader.hide();
        window.open = origOpen;
    }, { once: true });

    setTimeout(() => {
        loader.hide();
        window.open = origOpen;
    }, 15000);
}

function buildVideoPlayer(wrap, url, poster, videoType, mainLoader, server, requestId) {
    if (requestId && requestId !== renderCount) return;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) {
        if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy();
        wolfInstance = null;
    }

    wrap.innerHTML = '';
    const prevVideo = document.querySelector('#wolf-player-container video');
    if (prevVideo) { prevVideo.pause(); prevVideo.src = ''; }

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    const container = document.createElement('div');
    container.className = 'vp-wolf-wrap';
    container.id = 'wolf-player-container';
    wrap.appendChild(container);

    const vidLoader = createLoadingOverlay(container);
    let loaderHidden = false;
    function hideLoader() {
        if (loaderHidden) return;
        loaderHidden = true;
        vidLoader.hide();
        if (mainLoader) mainLoader.hide();
    }
    setTimeout(hideLoader, 10000);

    if (typeof window.WolfPlayer !== 'undefined') {
        const wolfConfig = {
            src: url,
            poster: poster || '',
            autoplay: false,
            color: '#00E676',
            volume: 0.8
        };

        if (videoType === 'hls' || isHLS(url)) {
            wolfConfig.hlsConfig = {
                maxBufferLength: isMobile ? 20 : 60,
                maxMaxBufferLength: isMobile ? 40 : 120,
                maxBufferSize: isMobile ? 40 * 1000 * 1000 : 80 * 1000 * 1000,
                startLevel: isMobile ? 0 : -1,
                capLevelToPlayerSize: true,
                autoStartLoad: true,
                enableWorker: true,
                backBufferLength: isMobile ? 15 : 40
            };
        }

        wolfInstance = new window.WolfPlayer('#wolf-player-container', wolfConfig);
        setTimeout(hideLoader, 2000);

        // Forzar precarga apenas el contenedor genere la etiqueta nativa (evitamos fallos API de WolfPlayer)
        let preloadAttempts = 0;
        const preloadIv = setInterval(() => {
            if (requestId && requestId !== renderCount) return clearInterval(preloadIv);
            const v = container.querySelector('video');
            if (v) {
                clearInterval(preloadIv);

                // Configuración crítica antes del load
                if (url.includes('pixeldrain.com')) {
                    v.setAttribute('referrerpolicy', 'no-referrer');
                }

                v.setAttribute('preload', 'auto');
                if (!url.includes('.m3u8')) v.load();
            } else if (++preloadAttempts > 40) {
                clearInterval(preloadIv);
            }
        }, 50);

        setTimeout(() => {
            if (requestId && requestId !== renderCount) return;

            const v = container.querySelector('video');
            if (v) {

                v.addEventListener('error', (e) => {
                    if (requestId && requestId !== renderCount) return;
                    console.error('❌ Error en video:', e);

                    if (server && server.url) {
                        const fallbackUrl = (url !== server.url) ? server.url : url;
                        console.warn('⚠️ Fallback a iframe:', fallbackUrl);
                        wrap.innerHTML = '';
                        const newLoader = createLoadingOverlay(wrap);
                        loadIframe(wrap, fallbackUrl, server, newLoader, requestId);
                        return;
                    }

                    hideLoader();
                    wrap.innerHTML = `<div class="player-placeholder">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <p>Error al cargar el video</p>
                      <small>El servidor rechazó la conexión. Intenta con otro servidor.</small>
                    </div>`;
                });

                let saveInterval = null;
                let resumeChecked = false;

                const checkResume = () => {
                    if (requestId && requestId !== renderCount) return;
                    if (resumeChecked) return;
                    const saved = getSavedTime();
                    if (!saved || saved <= 0) {
                        resumeChecked = true;
                        return;
                    }

                    const tryShow = () => {
                        if (requestId && requestId !== renderCount) return;
                        if (resumeChecked) return;
                        resumeChecked = true;

                        const currentTime = v.currentTime || 0;
                        const hasSignificantProgress = saved > 30;
                        const isNearStart = currentTime < 60 || Math.abs(currentTime - saved) > 60;

                        if (hasSignificantProgress && isNearStart) {
                            showResumeToast(saved, () => {
                                const jump = () => { v.currentTime = saved; v.play(); };
                                if (v.readyState >= 1) jump();
                                else {
                                    const h = () => { v.currentTime = saved; v.removeEventListener('loadedmetadata', h); };
                                    v.addEventListener('loadedmetadata', h);
                                    v.play();
                                }
                            }, () => { v.play(); });
                        }
                    };

                    tryShow();
                };

                // Llamar inmediatamente para mostrar el toast antes de que cargue el video
                checkResume();

                const doSave = () => {
                    if (requestId && requestId !== renderCount) return;
                    if (v.duration > 0) saveProgress(v.currentTime, v.duration);
                };

                v.addEventListener('loadedmetadata', checkResume);
                v.addEventListener('canplay', checkResume);

                v.addEventListener('play', () => {
                    if (requestId && requestId !== renderCount) return;
                    if (!saveInterval) saveInterval = setInterval(doSave, 3000);
                });

                v.addEventListener('pause', doSave);
                v.addEventListener('seeked', doSave);
                v.addEventListener('timeupdate', () => {
                    if (requestId && requestId !== renderCount) return;
                    if (!v._lastSave || Date.now() - v._lastSave > 5000) {
                        v._lastSave = Date.now();
                        doSave();
                    }
                });

                v.addEventListener('ended', () => {
                    if (requestId && requestId !== renderCount) return;
                    clearInterval(saveInterval);
                    const key = resumeKey();
                    if (key) localStorage.removeItem(key);
                });

                window.addEventListener('beforeunload', doSave);

                const introEnd = currentEpisode.introEnd;
                if (introEnd > 0) {
                    const skipBtn = document.createElement('button');
                    skipBtn.id = 'vp-skip-intro';
                    skipBtn.textContent = 'Omitir intro';
                    skipBtn.style.cssText = 'position:absolute;bottom:100px;right:20px;padding:8px 16px;background:rgba(0,230,118,0.9);color:#000;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;opacity:0;transition:opacity 0.3s;z-index:9999;pointer-events:auto';
                    container.appendChild(skipBtn);

                    skipBtn.addEventListener('click', (e) => {
                        if (requestId && requestId !== renderCount) return;
                        e.preventDefault();
                        e.stopPropagation();
                        v.currentTime = introEnd;
                        skipBtn.style.opacity = '0';
                        skipBtn.style.pointerEvents = 'none';
                    });

                    const checkIntro = () => {
                        if (requestId && requestId !== renderCount) return;
                        if (v.currentTime < introEnd && !v.paused) {
                            skipBtn.style.opacity = '1';
                            skipBtn.style.pointerEvents = 'auto';
                        } else {
                            skipBtn.style.opacity = '0';
                            skipBtn.style.pointerEvents = 'none';
                        }
                    };

                    v.addEventListener('play', checkIntro);
                    v.addEventListener('timeupdate', checkIntro);
                    v.addEventListener('seeked', checkIntro);
                }
            }
        }, 1000);
    } else {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = isMobile ? 'metadata' : 'auto';
        video.poster = poster;
        video.playsInline = true;
        video.style.cssText = 'width:100%;height:100%;background:#000;object-fit:contain';

        if (videoType === 'hls' || isHLS(url)) {
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
            } else if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
                const hls = new window.Hls({
                    maxBufferLength: isMobile ? 15 : 45,
                    maxMaxBufferLength: isMobile ? 30 : 90,
                    startLevel: isMobile ? 0 : -1
                });
                hls.loadSource(url);
                hls.attachMedia(video);
                hlsInstance = hls;
            } else {
                video.src = url;
            }
        } else {
            video.src = url;
        }

        container.appendChild(video);
        video.addEventListener('canplay', () => hideLoader(), { once: true });
        setTimeout(() => hideLoader(), 10000);
    }
}

function renderPlayer(animate = false) {
    const wrap = $('player-wrap');
    const myCount = ++renderCount;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (wolfInstance) {
        if (typeof wolfInstance.destroy === 'function') wolfInstance.destroy();
        wolfInstance = null;
    }

    wrap.innerHTML = '';
    wrap.classList.remove('loaded', 'switching');
    if (animate) wrap.classList.add('switching');

    const loader = createLoadingOverlay(wrap);

    // Validar que existan los datos necesarios
    if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) {
        loader.hide();
        wrap.innerHTML = `<div class="player-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p>Error: idioma no disponible</p>
        </div>`;
        wrap.classList.add('loaded');
        return;
    }

    if (!currentEpisode.langs[activeLang].servers || !currentEpisode.langs[activeLang].servers[activeServer]) {
        loader.hide();
        wrap.innerHTML = `<div class="player-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p>Error: servidor no disponible</p>
        </div>`;
        wrap.classList.add('loaded');
        return;
    }

    const server = currentEpisode.langs[activeLang].servers[activeServer];

    resolveUrl(server).then(resolved => {
        if (myCount !== renderCount) return;

        let url = typeof resolved === 'object' ? resolved.url : resolved;
        const poster = typeof resolved === 'object' ? resolved.poster : (currentEpisode.thumb || '');

        updateCast(url);

        if (!url) {
            loader.hide();
            wrap.innerHTML = `<div class="player-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <p>Sin URL — elige otro servidor</p>
            </div>`;
            wrap.classList.add('loaded');
            return;
        }

        if (isDirectVideo(url)) {
            buildVideoPlayer(wrap, url, poster, isHLS(url) ? 'hls' : 'mp4', loader, server, myCount);
        } else if (/^https?:\/\//i.test(url)) {
            detectVideoType(url).then(videoType => {
                if (myCount !== renderCount) return;
                if (videoType === 'hls' || videoType === 'mp4') {
                    buildVideoPlayer(wrap, url, poster, videoType, loader, server, myCount);
                } else {
                    loadIframe(wrap, server.url, server, loader, myCount);
                }
            });
        } else {
            loadIframe(wrap, server.url, server, loader, myCount);
        }

        requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('loaded')));
    });
}

// ── Modal configuración ───────────────────────────────────
(function () {
    const overlay = $('cfg-overlay');
    const sheet = $('cfg-sheet');
    const pill = $('cfg-autowatched-pill');
    const row = $('cfg-autowatched-row');
    let aw = localStorage.getItem('auto_watched') === '1';

    function updatePill() { if (pill) pill.classList.toggle('active', aw); }
    updatePill();

    const cfgBtn = $('cfg-btn');
    if (cfgBtn) {
        cfgBtn.addEventListener('click', () => {
            overlay.style.background = 'rgba(0,0,0,0.7)';
            overlay.style.pointerEvents = 'auto';
            sheet.style.transform = 'scale(1)';
            sheet.style.opacity = '1';
        });
    }

    function close() {
        if (!overlay) return;
        overlay.style.background = 'rgba(0,0,0,0)';
        overlay.style.pointerEvents = 'none';
        sheet.style.transform = 'scale(0.92)';
        sheet.style.opacity = '0';
    }

    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const cfgClose = $('cfg-close');
    if (cfgClose) cfgClose.addEventListener('click', close);
    if (row) {
        row.addEventListener('click', () => {
            aw = !aw;
            localStorage.setItem('auto_watched', aw ? '1' : '0');
            updatePill();
        });
    }
})();

// ── Eventos del reproductor ───────────────────────────────
const closePlayerBtn = $('btn-close-player');
if (closePlayerBtn) {
    closePlayerBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        closePlayer();
    });
}

const langBtn = $('btn-lang');
if (langBtn) {
    langBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        openPicker('lang');
    });
}
const srvBtn = $('btn-srv');
if (srvBtn) {
    srvBtn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        openPicker('srv');
    });
}

// Quitar foco de todos los botones después de hacer click
document.addEventListener('click', (e) => {
    if (e.target.closest('.action-btn, .nav-btn')) {
        setTimeout(() => {
            if (document.activeElement) {
                document.activeElement.blur();
            }
        }, 100);
    }
}, true);

// Botón de transmitir (cast)
const castBtn = $('btn-cast');
if (castBtn) {
    castBtn.addEventListener('click', (e) => {
        const btn = e.currentTarget;

        if (!currentEpisode || !currentEpisode.langs || !currentEpisode.langs[activeLang]) {
            return;
        }

        const server = currentEpisode.langs[activeLang].servers[activeServer];
        if (!server || !server.url) {
            return;
        }

        const url = server.url;
        const castUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=${url.startsWith('https') ? 'https' : 'http'};package=com.instantbits.cast.webvideo;end`;

        // Quitar el foco inmediatamente
        setTimeout(() => btn.blur(), 0);

        if (typeof window.openCastModal === 'function') {
            window.openCastModal(castUrl);
        } else {
            window.location.href = castUrl;
        }
    });
}

// ── Inicialización ────────────────────────────────────────
renderTabs();
renderEpisodes(true);

if (localStorage.getItem('auto_watched') === '1') {
    const map = getWatchedMap();
    let highestS = -1;
    let highestE = -1;

    for (let s = SERIE.seasons.length - 1; s >= 0; s--) {
        const eps = SERIE.seasons[s].episodes;
        for (let i = eps.length - 1; i >= 0; i--) {
            if (isWatched(map, s, eps[i].num)) {
                highestS = s;
                highestE = eps[i].num;
                break;
            }
        }
        if (highestS !== -1) break;
    }

    if (highestS !== -1 && highestE !== -1) {
        setTimeout(() => playEpisode(highestS, highestE), 150);
    }
}


// ── Modal de Reportes ─────────────────────────────────────
(function () {
    const overlay = document.getElementById('report-modal-overlay');
    const box = document.getElementById('report-modal-box');
    const closeBtn = document.getElementById('report-modal-close');
    const sendBtn = document.getElementById('report-send-btn');
    const status = document.getElementById('report-status');
    const comment = document.getElementById('report-comment');
    const typeSelect = document.getElementById('report-type-select');
    const langSelect = document.getElementById('report-lang-select');
    const srvSelect = document.getElementById('report-srv-select');
    const formView = document.getElementById('report-form-view');
    const successView = document.getElementById('report-success-view');
    const successIcon = document.getElementById('report-success-icon');

    function openModal() {
        if (!currentEpisode) return;

        langSelect.innerHTML = '';
        (currentEpisode.langs || []).forEach((l, i) => {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = l.name;
            if (i === activeLang) o.selected = true;
            langSelect.appendChild(o);
        });

        function fillServers(li) {
            srvSelect.innerHTML = '';
            (currentEpisode.langs?.[li]?.servers || []).forEach((s, i) => {
                const o = document.createElement('option');
                o.value = i;
                o.textContent = s.name;
                if (li === activeLang && i === activeServer) o.selected = true;
                srvSelect.appendChild(o);
            });
        }

        fillServers(activeLang);
        if (langSelect) langSelect.addEventListener('change', () => fillServers(+langSelect.value));

        typeSelect.value = '';
        comment.value = '';
        status.textContent = '';
        formView.style.display = '';
        successView.style.display = 'none';
        successIcon.style.transform = 'scale(0.5)';
        successIcon.style.opacity = '0';
        overlay.style.display = 'flex';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            box.style.transform = 'scale(1)';
            box.style.opacity = '1';
        }));
    }

    function closeModal() {
        box.style.transform = 'scale(0.94)';
        box.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 220);
    }

    const reportBtn = $('btn-report');
    if (reportBtn) reportBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal();
        });
    }

    sendBtn.addEventListener('click', async () => {
        const cfg = window.REPORT_CONFIG || {};
        if (!cfg.botToken || cfg.botToken === 'TU_BOT_TOKEN_AQUI') {
            status.style.color = '#ff5050';
            status.textContent = 'Bot de Telegram no configurado.';
            return;
        }

        if (!typeSelect.value) {
            status.style.color = '#ff5050';
            status.textContent = 'Selecciona un tipo de problema.';
            return;
        }

        const li = +langSelect.value;
        const si = +srvSelect.value;
        const lang = currentEpisode.langs?.[li]?.name || '-';
        const server = currentEpisode.langs?.[li]?.servers?.[si]?.name || '-';

        const lines = [
            '🚨 *Nuevo reporte*',
            `🆔 *ID Serie:* \`${SERIE.id || '-'}\``,
            `📺 *Serie:* \`${SERIE.title || '-'}\``,
            `🎭 *Tipo:* \`Episodio\``,
            `📅 *Temporada:* \`${activeSeason + 1}\``,
            `🎞 *Episodio:* \`${currentEpisode.num} - ${currentEpisode.title || '-'}\``,
            `🌐 *Idioma:* \`${lang}\``,
            `🖥 *Servidor:* \`${server}\``,
            `⚠️ *Problema:* \`${typeSelect.value}\``,
            comment.value.trim() ? `💬 *Comentario:* \`${comment.value.trim()}\`` : null
        ].filter(Boolean).join('\n');

        sendBtn.disabled = true;
        status.style.color = '#888899';
        status.textContent = 'Enviando...';

        try {
            const body = {
                chat_id: cfg.chatId,
                text: lines,
                parse_mode: 'Markdown'
            };
            if (cfg.topicId) body.message_thread_id = cfg.topicId;

            const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.ok) {
                formView.style.display = 'none';
                successView.style.display = '';
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    successIcon.style.transform = 'scale(1)';
                    successIcon.style.opacity = '1';
                }));
                setTimeout(closeModal, 2000);
            } else {
                throw new Error(data.description);
            }
        } catch {
            status.style.color = '#ff5050';
            status.textContent = 'Error al enviar. Intenta de nuevo.';
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    });
})();
