(function () {
  'use strict';

const CF_BASE = 'https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com';

let allVideos   = [];
let categories  = [];
let activeCategory = 'all';
let currentMode = 'grid';
let playerHls   = null;

// Reels state
let reelsObserver = null;
let globalMuted   = true;
let hlsInstances  = {};
let activeUid     = null;

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const [catRes, vidRes] = await Promise.all([
      fetch('/api/videos?action=categories'),
      fetch('/api/videos?action=list')
    ]);
    const catData = await catRes.json();
    const vidData = await vidRes.json();
    categories = catData.categories || [];
    allVideos  = vidData.videos || [];
  } catch (e) {
    // Fallback to static JSON
    try {
      const res = await fetch('/videos.json');
      const json = await res.json();
      allVideos = json.map(v => ({
        cloudflare_uid: v.uid, title: v.title, description: v.description,
        category_slug: v.group, category_label: v.group, category_color: null
      }));
      categories = [...new Set(json.map(v => v.group))].map((g, i) => ({
        slug: g, label: g, sort_order: i, video_count: json.filter(v => v.group === g).length
      }));
    } catch { allVideos = []; categories = []; }
  }

  buildCatPills();
  renderGrid();
});

// ── Mode switching ───────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  document.getElementById('btnGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('btnReels').classList.toggle('active', mode === 'reels');

  if (mode === 'grid') {
    document.getElementById('gridPage').style.display = 'block';
    document.getElementById('reelsFS').classList.remove('open');
    destroyAllHls();
  } else {
    document.getElementById('gridPage').style.display = 'none';
    document.getElementById('reelsFS').classList.add('open');
    renderReels();
  }
}

// ── Category pills ───────────────────────────────────────────────────────────
function buildCatPills() {
  const total = allVideos.length;
  let html = `<button class="cat-pill active" data-action="filter-cat" data-slug="all">All <span class="count">${total}</span></button>`;
  for (const c of categories) {
    html += `<button class="cat-pill" data-action="filter-cat" data-slug="${c.slug}">${esc(c.label)} <span class="count">${c.video_count || 0}</span></button>`;
  }
  document.getElementById('catPills').innerHTML = html;
}

function filterCat(slug) {
  activeCategory = slug;
  document.querySelectorAll('.cat-pill').forEach((btn, i) => {
    if (i === 0) btn.classList.toggle('active', slug === 'all');
    else btn.classList.toggle('active', categories[i - 1]?.slug === slug);
  });
  if (currentMode === 'grid') renderGrid();
  else renderReels();
}

// ── Grid view ────────────────────────────────────────────────────────────────
function renderGrid() {
  const filtered = activeCategory === 'all' ? allVideos : allVideos.filter(v => v.category_slug === activeCategory);
  const container = document.getElementById('gridContent');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎬</div><p>No videos in this category yet.</p></div>';
    return;
  }

  container.innerHTML = '<div class="video-grid">' + filtered.map(v => {
    const thumbUrl = v.thumbnail_url || `${CF_BASE}/${v.cloudflare_uid}/thumbnails/thumbnail.jpg?time=2s&width=480`;
    const tagColor = v.category_color || 'rgba(245,131,33,0.2)';

    return `
      <div class="video-card" data-action="open-player" data-uid="${v.cloudflare_uid}" data-title="${esc(v.title)}" data-desc="${esc(v.description || '')}">
        <div class="video-thumb">
          <img src="${thumbUrl}" alt="${esc(v.title)}" loading="lazy" onerror="this.style.display='none'">
          <div class="video-thumb-play"><div class="video-thumb-play-icon">▶</div></div>
          ${v.duration_seconds ? `<span class="video-duration">${formatDuration(v.duration_seconds)}</span>` : ''}
        </div>
        <div class="video-card-body">
          <span class="video-card-tag" style="background:${tagColor};color:rgba(255,255,255,0.95)">${esc(v.category_label || v.category_slug)}</span>
          ${v.learner_only ? '<span class="video-card-learner-badge">Learner only</span>' : ''}
          <div class="video-card-title">${esc(v.title)}</div>
          ${v.description ? `<div class="video-card-desc">${esc(v.description)}</div>` : ''}
        </div>
      </div>`;
  }).join('') + '</div>';
}

// ── Player modal ─────────────────────────────────────────────────────────────
function openPlayer(uid, title, desc) {
  document.getElementById('playerTitle').textContent = title;
  document.getElementById('playerDesc').textContent = desc;

  const video = document.getElementById('playerVideo');
  const hlsUrl = `${CF_BASE}/${uid}/manifest/video.m3u8`;

  if (playerHls) { playerHls.destroy(); playerHls = null; }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hlsUrl;
    video.play().catch(() => {});
  } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    playerHls = new Hls({ enableWorker: true, startLevel: -1 });
    playerHls.loadSource(hlsUrl);
    playerHls.attachMedia(video);
    playerHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else {
    video.src = hlsUrl;
    video.play().catch(() => {});
  }

  document.getElementById('playerOverlay').classList.add('open');
}

function closePlayer() {
  const video = document.getElementById('playerVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (playerHls) { playerHls.destroy(); playerHls = null; }
  document.getElementById('playerOverlay').classList.remove('open');
}

function handlePlayerOverlayClick(e) {
  if (e.target === document.getElementById('playerOverlay')) closePlayer();
}

// ── Reels view ───────────────────────────────────────────────────────────────
function renderReels() {
  const filtered = activeCategory === 'all' ? allVideos : allVideos.filter(v => v.category_slug === activeCategory);
  const container = document.getElementById('reelsContainer');

  if (reelsObserver) reelsObserver.disconnect();
  destroyAllHls();

  if (filtered.length === 0) {
    container.innerHTML = '<div style="height:100dvh;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);font-size:0.9rem;padding:40px;text-align:center;">No videos in this category yet.</div>';
    return;
  }

  container.innerHTML = filtered.map(v => `
    <div class="reel-item" id="reel-${v.cloudflare_uid}" data-uid="${v.cloudflare_uid}">
      <video class="reel-video" id="video-${v.cloudflare_uid}" playsinline webkit-playsinline preload="none" loop muted></video>
      <div class="muted-banner" id="banner-${v.cloudflare_uid}">Tap to unmute</div>
      <div class="reel-overlay">
        <div class="reel-group-tag" style="background:${v.category_color || 'rgba(245,131,33,0.25)'}; color:rgba(255,255,255,0.95)">${esc(v.category_label || v.category_slug)}</div>
        <div class="reel-title">${esc(v.title)}</div>
        ${v.description ? `<div class="reel-desc">${esc(v.description)}</div>` : ''}
      </div>
      <button class="mute-btn" id="mute-btn-${v.cloudflare_uid}" data-action="toggle-mute" data-uid="${v.cloudflare_uid}" title="Toggle mute">🔇</button>
    </div>`).join('');

  filtered.forEach(v => {
    document.getElementById(`reel-${v.cloudflare_uid}`)
      .addEventListener('click', e => { if (!e.target.closest('.mute-btn')) toggleMute(v.cloudflare_uid); });
  });

  container.scrollTop = 0;
  setupReelsObserver(filtered);
}

function attachHls(uid) {
  const video = document.getElementById(`video-${uid}`);
  if (!video) return;
  const hlsUrl = `${CF_BASE}/${uid}/manifest/video.m3u8`;
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hlsUrl; video.muted = globalMuted; video.play().catch(() => {}); return;
  }
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, startLevel: -1 });
    hls.loadSource(hlsUrl); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { video.muted = globalMuted; video.play().catch(() => {}); });
    hlsInstances[uid] = hls; return;
  }
  video.src = hlsUrl; video.muted = globalMuted; video.play().catch(() => {});
}

function detachHls(uid) {
  const video = document.getElementById(`video-${uid}`);
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  if (hlsInstances[uid]) { hlsInstances[uid].destroy(); delete hlsInstances[uid]; }
}

function destroyAllHls() {
  Object.keys(hlsInstances).forEach(uid => detachHls(uid));
  hlsInstances = {}; activeUid = null;
}

function setupReelsObserver(videos) {
  reelsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const uid = entry.target.dataset.uid;
      if (entry.isIntersecting) {
        if (activeUid && activeUid !== uid) detachHls(activeUid);
        activeUid = uid; attachHls(uid);
        setMuteBtn(uid, globalMuted);
        if (globalMuted) showMutedBanner(uid);
      } else if (uid !== activeUid) {
        detachHls(uid); hideMutedBanner(uid);
      }
    });
  }, { root: document.getElementById('reelsContainer'), threshold: 0.6 });

  videos.forEach(v => {
    const el = document.getElementById(`reel-${v.cloudflare_uid}`);
    if (el) reelsObserver.observe(el);
  });
}

function toggleMute(uid) {
  globalMuted = !globalMuted;
  const video = document.getElementById(`video-${uid}`);
  if (video) { video.muted = globalMuted; if (!globalMuted && video.paused) video.play().catch(() => {}); }
  document.querySelectorAll('.mute-btn').forEach(btn => btn.textContent = globalMuted ? '🔇' : '🔊');
  if (!globalMuted) hideMutedBanner(uid);
}

function setMuteBtn(uid, muted) {
  const btn = document.getElementById(`mute-btn-${uid}`);
  if (btn) btn.textContent = muted ? '🔇' : '🔊';
}

function showMutedBanner(uid) {
  const b = document.getElementById(`banner-${uid}`);
  if (!b) return; b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 3000);
}

function hideMutedBanner(uid) {
  const el = document.getElementById(`banner-${uid}`);
  if (el) el.classList.remove('show');
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? h + ':' + String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0') : m + ':' + String(ss).padStart(2,'0');
}

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'filter-cat') filterCat(t.dataset.slug);
  else if (a === 'open-player') openPlayer(t.dataset.uid, t.dataset.title, t.dataset.desc);
  else if (a === 'toggle-mute') toggleMute(t.dataset.uid);
});
(function wire() {
  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
  });
  var overlay = document.getElementById('playerOverlay');
  if (overlay) overlay.addEventListener('click', handlePlayerOverlayClick);
  var closeBtn = document.getElementById('btn-close-player');
  if (closeBtn) closeBtn.addEventListener('click', closePlayer);
})();
})();
