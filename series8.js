(function () {
  const seasonsTabs = document.getElementById('seasons-tabs');
  const episodesList = document.getElementById('episodes-list');
  const playerSection = document.getElementById('player-section');
  const playerWrap = document.getElementById('player-wrap');
  const playerEpTitle = document.getElementById('player-ep-title');
  const btnClosePlayer = document.getElementById('btn-close-player');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnLang = document.getElementById('btn-lang');
  const btnSrv = document.getElementById('btn-srv');
  const btnLangLabel = document.getElementById('btn-lang-label');
  const btnSrvLabel = document.getElementById('btn-srv-label');
  const headerTitle = document.getElementById('header-title');

  if (headerTitle) headerTitle.textContent = SERIE.title;

  let currentSeasonIdx = 0;
  let currentEpisodeIdx = 0;
  let preferredLangName = ''; // Global preferred language
  let currentSrvIdx = 0;

  function init() {
    renderSeasons();
    renderEpisodes(0);
    setupEventListeners();
  }

  function renderSeasons() {
    if (!seasonsTabs) return;
    seasonsTabs.innerHTML = '';
    SERIE.seasons.forEach((season, idx) => {
      const tab = document.createElement('button');
      tab.className = `season-tab ${idx === currentSeasonIdx ? 'active' : ''}`;
      tab.textContent = season.label;
      tab.onclick = () => {
        document.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentSeasonIdx = idx;
        renderEpisodes(idx);
      };
      seasonsTabs.appendChild(tab);
    });
  }

  function renderEpisodes(seasonIdx) {
    if (!episodesList) return;
    episodesList.innerHTML = '';
    const season = SERIE.seasons[seasonIdx];
    season.episodes.forEach((ep, idx) => {
      const item = document.createElement('div');
      item.className = 'episode-item';
      item.innerHTML = `
        <div class="ep-thumb">
          <img src="${ep.thumb}" alt="${ep.title}">
          <div class="ep-play-overlay">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="ep-info">
          <div class="ep-num">Episodio ${ep.num}</div>
          <div class="ep-title">${ep.title}</div>
          <div class="ep-meta">${ep.duration}</div>
        </div>
      `;
      item.onclick = () => loadEpisode(seasonIdx, idx);
      episodesList.appendChild(item);
    });
  }

  function loadEpisode(sIdx, eIdx, isManualChange = false) {
    currentSeasonIdx = sIdx;
    currentEpisodeIdx = eIdx;

    if (!isManualChange) {
      currentSrvIdx = 0; // Reset server on episode change
    }

    const ep = SERIE.seasons[sIdx].episodes[eIdx];

    // Intenta encontrar el idioma preferido
    let lIdx = ep.langs.findIndex(l => l.name === preferredLangName);
    if (lIdx === -1) {
      lIdx = 0; // Fallback al primero si no existe el preferido
    } else {
      // Si existe, aseguramos que preferredLangName sea el correcto (por si era el primero/default)
      preferredLangName = ep.langs[lIdx].name;
    }

    // Inicializamos preferredLangName si es la primera vez
    if (!preferredLangName && ep.langs.length > 0) {
      preferredLangName = ep.langs[0].name;
    }

    const lang = ep.langs[lIdx];
    const srv = lang.servers[currentSrvIdx] || lang.servers[0];
    if (!lang.servers[currentSrvIdx]) currentSrvIdx = 0;

    if (playerEpTitle) playerEpTitle.textContent = `E${ep.num} - ${ep.title}`;
    if (btnLangLabel) btnLangLabel.textContent = lang.name;
    if (btnSrvLabel) btnSrvLabel.textContent = srv.name;

    playerSection.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    loadStream(srv.url);

    btnPrev.disabled = (eIdx === 0);
    btnNext.disabled = (eIdx === SERIE.seasons[sIdx].episodes.length - 1);
  }

  function loadStream(url) {
    playerWrap.innerHTML = '';
    if (url.includes('.m3u8') || url.includes('player.zilla-networks.com')) {
      const video = document.createElement('video');
      video.id = 'wolf-player';
      video.controls = true;
      video.style.width = '100%';
      video.style.height = '100%';
      playerWrap.appendChild(video);

      if (window.WolfPlayer) {
        new WolfPlayer({ element: video, src: url, autoplay: true });
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        video.play();
      } else {
        video.src = url;
        video.play();
      }
    } else {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('frameborder', '0');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      playerWrap.appendChild(iframe);
    }
  }

  function closePlayer() {
    playerWrap.innerHTML = '';
    playerSection.style.display = 'none';
    document.body.style.overflow = '';
  }

  function setupEventListeners() {
    if (btnClosePlayer) btnClosePlayer.onclick = closePlayer;

    if (btnPrev) btnPrev.onclick = () => {
      if (currentEpisodeIdx > 0) loadEpisode(currentSeasonIdx, currentEpisodeIdx - 1);
    };

    if (btnNext) btnNext.onclick = () => {
      if (currentEpisodeIdx < SERIE.seasons[currentSeasonIdx].episodes.length - 1) {
        loadEpisode(currentSeasonIdx, currentEpisodeIdx + 1);
      }
    };

    if (btnLang) btnLang.onclick = () => {
      const ep = SERIE.seasons[currentSeasonIdx].episodes[currentEpisodeIdx];
      let lIdx = ep.langs.findIndex(l => l.name === preferredLangName);
      if (lIdx === -1) lIdx = 0;
      lIdx = (lIdx + 1) % ep.langs.length;
      preferredLangName = ep.langs[lIdx].name;
      currentSrvIdx = 0;
      loadEpisode(currentSeasonIdx, currentEpisodeIdx, true);
    };

    if (btnSrv) btnSrv.onclick = () => {
      const ep = SERIE.seasons[currentSeasonIdx].episodes[currentEpisodeIdx];
      let lIdx = ep.langs.findIndex(l => l.name === preferredLangName);
      if (lIdx === -1) lIdx = 0;
      const lang = ep.langs[lIdx];
      currentSrvIdx = (currentSrvIdx + 1) % lang.servers.length;
      loadEpisode(currentSeasonIdx, currentEpisodeIdx, true);
    };
  }

  init();
})();
