(function () {
  'use strict';

// ── Hamburger menu toggle ──
document.querySelector('.nav-menu-toggle')?.addEventListener('click', function() {
  const dd = document.querySelector('.nav-dropdown');
  const open = dd.classList.toggle('open');
  this.setAttribute('aria-expanded', open);
});
document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-menu-toggle') && !e.target.closest('.nav-dropdown')) {
    document.querySelector('.nav-dropdown')?.classList.remove('open');
    document.querySelector('.nav-menu-toggle')?.setAttribute('aria-expanded', 'false');
  }
});

// Auth (optional — page is viewable without login)
const session = ccAuth.getAuth();
if (session?.user?.name) document.getElementById('user-name').textContent = session.user.name;
function logout() { ccAuth.logout(); }

const CF_BASE = 'https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com';
let allVideos = [], categories = [], activeCategory = 'all', currentMode = 'grid', playerHls = null;
let reelsObserver = null, globalMuted = true, hlsInstances = {}, activeUid = null;

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const [catRes, vidRes] = await Promise.all([
      fetch('/api/videos?action=categories'),
      fetch('/api/videos?action=list&learner_only=true')
    ]);
    categories = (await catRes.json()).categories || [];
    allVideos  = (await vidRes.json()).videos || [];
  } catch {
    try {
      const json = await (await fetch('/videos.json')).json();
      allVideos = json.map(v => ({ cloudflare_uid: v.uid, title: v.title, description: v.description, category_slug: v.group, category_label: v.group }));
      categories = [...new Set(json.map(v => v.group))].map((g,i) => ({ slug: g, label: g, sort_order: i, video_count: json.filter(v => v.group === g).length }));
    } catch { allVideos = []; categories = []; }
  }
  buildCatPills(); renderGrid();
});

function setMode(mode) {
  currentMode = mode;
  document.getElementById('btnGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('btnReels').classList.toggle('active', mode === 'reels');
  if (mode === 'grid') {
    document.getElementById('gridPage').style.display = 'block';
    document.getElementById('reelsFS').classList.remove('open'); destroyAllHls();
  } else {
    document.getElementById('gridPage').style.display = 'none';
    document.getElementById('reelsFS').classList.add('open'); renderReels();
  }
}

function buildCatPills() {
  let html = `<button class="cat-pill active" data-action="filter-cat" data-slug="all">All <span class="count">${allVideos.length}</span></button>`;
  categories.forEach(c => { html += `<button class="cat-pill" data-action="filter-cat" data-slug="${c.slug}">${esc(c.label)} <span class="count">${c.video_count||0}</span></button>`; });
  document.getElementById('catPills').innerHTML = html;
}

function filterCat(slug) {
  activeCategory = slug;
  document.querySelectorAll('.cat-pill').forEach((b,i) => { b.classList.toggle('active', i === 0 ? slug === 'all' : categories[i-1]?.slug === slug); });
  currentMode === 'grid' ? renderGrid() : renderReels();
}

function renderGrid() {
  const f = activeCategory === 'all' ? allVideos : allVideos.filter(v => v.category_slug === activeCategory);
  const c = document.getElementById('gridContent');
  if (!f.length) { c.innerHTML = '<div class="empty-state"><div class="empty-icon">🎬</div><p>No videos in this category yet.</p></div>'; return; }
  c.innerHTML = '<div class="video-grid">' + f.map(v => {
    const thumb = v.thumbnail_url || `${CF_BASE}/${v.cloudflare_uid}/thumbnails/thumbnail.jpg?time=2s&width=480`;
    return `<div class="video-card" data-action="open-player" data-uid="${v.cloudflare_uid}" data-title="${esc(v.title)}" data-desc="${esc(v.description||'')}">
      <div class="video-thumb"><img src="${thumb}" alt="${esc(v.title)}" loading="lazy" onerror="this.style.display='none'"><div class="video-thumb-play"><div class="video-thumb-play-icon">▶</div></div>${v.duration_seconds ? `<span class="video-duration">${formatDuration(v.duration_seconds)}</span>` : ''}</div>
      <div class="video-card-body"><span class="video-card-tag" style="background:${v.category_color||'rgba(245,131,33,0.2)'};color:rgba(255,255,255,0.95)">${esc(v.category_label||v.category_slug)}</span>
      <div class="video-card-title">${esc(v.title)}</div>${v.description ? `<div class="video-card-desc">${esc(v.description)}</div>` : ''}</div></div>`;
  }).join('') + '</div>';
}

function openPlayer(uid, title, desc) {
  document.getElementById('playerTitle').textContent = title;
  document.getElementById('playerDesc').textContent = desc;
  const video = document.getElementById('playerVideo');
  const url = `${CF_BASE}/${uid}/manifest/video.m3u8`;
  if (playerHls) { playerHls.destroy(); playerHls = null; }
  if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; video.play().catch(()=>{}); }
  else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    playerHls = new Hls({ enableWorker: true, startLevel: -1 });
    playerHls.loadSource(url); playerHls.attachMedia(video);
    playerHls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
  } else { video.src = url; video.play().catch(()=>{}); }
  document.getElementById('playerOverlay').classList.add('open');
}

function closePlayer() {
  const v = document.getElementById('playerVideo'); v.pause(); v.removeAttribute('src'); v.load();
  if (playerHls) { playerHls.destroy(); playerHls = null; }
  document.getElementById('playerOverlay').classList.remove('open');
}

function renderReels() {
  const f = activeCategory === 'all' ? allVideos : allVideos.filter(v => v.category_slug === activeCategory);
  const c = document.getElementById('reelsContainer');
  if (reelsObserver) reelsObserver.disconnect(); destroyAllHls();
  if (!f.length) { c.innerHTML = '<div style="height:100dvh;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5)">No videos yet.</div>'; return; }
  c.innerHTML = f.map(v => `<div class="reel-item" id="reel-${v.cloudflare_uid}" data-uid="${v.cloudflare_uid}">
    <video class="reel-video" id="video-${v.cloudflare_uid}" playsinline webkit-playsinline preload="none" loop muted></video>
    <div class="muted-banner" id="banner-${v.cloudflare_uid}">Tap to unmute</div>
    <div class="reel-overlay"><div class="reel-group-tag" style="background:${v.category_color||'rgba(245,131,33,0.25)'};color:rgba(255,255,255,0.95)">${esc(v.category_label||v.category_slug)}</div>
    <div class="reel-title">${esc(v.title)}</div>${v.description?`<div class="reel-desc">${esc(v.description)}</div>`:''}</div>
    <button class="mute-btn" id="mute-btn-${v.cloudflare_uid}" data-action="toggle-mute" data-uid="${v.cloudflare_uid}">🔇</button></div>`).join('');
  f.forEach(v => { document.getElementById(`reel-${v.cloudflare_uid}`).addEventListener('click', e => { if (!e.target.closest('.mute-btn')) toggleMute(v.cloudflare_uid); }); });
  c.scrollTop = 0; setupObs(f);
}

function attachHls(uid) {
  const v = document.getElementById(`video-${uid}`); if (!v) return;
  const url = `${CF_BASE}/${uid}/manifest/video.m3u8`;
  if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; v.muted = globalMuted; v.play().catch(()=>{}); return; }
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const h = new Hls({ enableWorker: true, startLevel: -1 }); h.loadSource(url); h.attachMedia(v);
    h.on(Hls.Events.MANIFEST_PARSED, () => { v.muted = globalMuted; v.play().catch(()=>{}); }); hlsInstances[uid] = h; return;
  }
  v.src = url; v.muted = globalMuted; v.play().catch(()=>{});
}
function detachHls(uid) {
  const v = document.getElementById(`video-${uid}`); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  if (hlsInstances[uid]) { hlsInstances[uid].destroy(); delete hlsInstances[uid]; }
}
function destroyAllHls() { Object.keys(hlsInstances).forEach(uid => detachHls(uid)); hlsInstances = {}; activeUid = null; }

function setupObs(videos) {
  reelsObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const uid = e.target.dataset.uid;
      if (e.isIntersecting) { if (activeUid && activeUid !== uid) detachHls(activeUid); activeUid = uid; attachHls(uid); if (globalMuted) showBanner(uid); }
      else if (uid !== activeUid) { detachHls(uid); }
    });
  }, { root: document.getElementById('reelsContainer'), threshold: 0.6 });
  videos.forEach(v => { const el = document.getElementById(`reel-${v.cloudflare_uid}`); if (el) reelsObserver.observe(el); });
}

function toggleMute(uid) {
  globalMuted = !globalMuted;
  const v = document.getElementById(`video-${uid}`);
  if (v) { v.muted = globalMuted; if (!globalMuted && v.paused) v.play().catch(()=>{}); }
  document.querySelectorAll('.mute-btn').forEach(b => b.textContent = globalMuted ? '🔇' : '🔊');
  if (!globalMuted) hideBanner(uid);
}
function showBanner(uid) { const b = document.getElementById(`banner-${uid}`); if (b) { b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 3000); } }
function hideBanner(uid) { const b = document.getElementById(`banner-${uid}`); if (b) b.classList.remove('show'); }

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? h + ':' + String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0') : m + ':' + String(ss).padStart(2,'0');
}

// ── CSP-friendly event delegation ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'filter-cat') filterCat(target.dataset.slug);
  else if (action === 'open-player') openPlayer(target.dataset.uid, target.dataset.title, target.dataset.desc);
  else if (action === 'toggle-mute') toggleMute(target.dataset.uid);
});
// Static handlers
(function wire() {
  var signOut = document.getElementById('btn-signout-drop');
  if (signOut) signOut.addEventListener('click', function () { if (typeof logout === 'function') logout(); });
  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
  });
  var overlay = document.getElementById('playerOverlay');
  if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closePlayer(); });
  var closeBtn = document.getElementById('btn-close-player');
  if (closeBtn) closeBtn.addEventListener('click', closePlayer);
})();
})();
