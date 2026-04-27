(function () {
  'use strict';

  var ccAuth = window.ccAuth;
  if (!ccAuth) return;

  // Gate the whole page on login. ccAuth.requireAuth() shows the shared
  // sign-in modal when the user is not logged in. Don't fetch anything
  // until we know we're authed — otherwise the API returns 401, the JSON
  // parse succeeds with an error body, and we end up rendering an empty
  // share-link card.
  if (!ccAuth.isLoggedIn) {
    // Hide the loading panel so "Maybe later" leaves a clean (empty) page
    // behind the modal instead of a stuck spinner.
    var loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
    ccAuth.requireAuth();
    return;
  }

  var $ = function (id) { return document.getElementById(id); };

  var elLoading   = $('loading');
  var elDisabled  = $('disabled-state');
  var elMain      = $('main-content');
  var elShareUrl  = $('share-url');
  var elCopyBtn   = $('btn-copy');
  var elCopyLabel = $('btn-copy-label');
  var elShareBtn  = $('btn-share-native');
  var elFriends   = $('stat-friends');
  var elEarned    = $('stat-earned');
  var elList      = $('recent-list');

  var shareUrl = '';

  // ── Capture (PostHog only fires if user has consented) ───────────────────
  function track(event, props) {
    if (typeof window.posthog === 'undefined' || !window.posthog.capture) return;
    try { window.posthog.capture(event, props || {}); } catch (e) {}
  }

  // ── Format helpers ───────────────────────────────────────────────────────
  function formatMinutes(mins) {
    if (!mins || mins <= 0) return '0 min';
    if (mins < 60) return mins + ' min';
    var hours = Math.floor(mins / 60);
    var rem = mins % 60;
    if (rem === 0) return hours + ' hr';
    return hours + ' hr ' + rem + ' min';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Render recent referrals ──────────────────────────────────────────────
  function renderRecent(list) {
    if (!list || list.length === 0) {
      elList.innerHTML = '<div class="ref-empty">No one yet — share your link above.</div>';
      return;
    }
    var badgeMap = {
      joined:   { cls: 'ref-badge-joined',   text: 'Joined' },
      booked:   { cls: 'ref-badge-booked',   text: 'Booked' },
      lessoned: { cls: 'ref-badge-lessoned', text: 'Driving' }
    };
    var html = list.map(function (r) {
      var b = badgeMap[r.status] || badgeMap.joined;
      var name = r.name || 'A friend';
      return (
        '<div class="ref-row">' +
          '<div>' +
            '<div class="ref-row-name">' + escape(name) + '</div>' +
            '<div class="ref-row-sub">Joined ' + formatDate(r.created_at) + '</div>' +
          '</div>' +
          '<span class="ref-badge ' + b.cls + '">' + b.text + '</span>' +
        '</div>'
      );
    }).join('');
    elList.innerHTML = html;
  }

  // ── Copy link ────────────────────────────────────────────────────────────
  function copyLink() {
    if (!shareUrl) return;
    var done = function () {
      elCopyBtn.classList.add('copied');
      elCopyLabel.textContent = 'Copied!';
      track('referral_link_copied');
      setTimeout(function () {
        elCopyBtn.classList.remove('copied');
        elCopyLabel.textContent = 'Copy link';
      }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(done).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      // Old-browser fallback. Create a temporary textarea, select, exec.
      var ta = document.createElement('textarea');
      ta.value = shareUrl;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  // ── Native share (mobile only) ───────────────────────────────────────────
  function nativeShare() {
    if (!shareUrl || !navigator.share) return;
    navigator.share({ url: shareUrl })
      .then(function () { track('referral_link_shared', { method: 'native' }); })
      .catch(function () { /* user cancelled — silent */ });
  }

  // ── Load data ────────────────────────────────────────────────────────────
  function load() {
    Promise.all([
      ccAuth.fetchAuthed('/api/learner?action=referral-code').then(function (r) { return r.json(); }),
      ccAuth.fetchAuthed('/api/learner?action=referral-stats').then(function (r) { return r.json(); })
    ]).then(function (results) {
      var codeData  = results[0];
      var statsData = results[1];

      elLoading.style.display = 'none';

      if (!codeData || codeData.enabled === false) {
        elDisabled.style.display = 'block';
        return;
      }

      shareUrl = codeData.share_url || '';
      elShareUrl.textContent = shareUrl;

      elFriends.textContent = (statsData && statsData.total_referred) || 0;
      elEarned.textContent  = formatMinutes(statsData && statsData.total_reward_minutes);

      renderRecent(statsData && statsData.recent_referrals);

      // Show native share only on devices that support it
      if (navigator.share && shareUrl) {
        elShareBtn.style.display = 'flex';
      }

      elMain.style.display = 'block';
      track('referral_page_viewed');
    }).catch(function (err) {
      console.error('refer.js load failed', err);
      elLoading.innerHTML = 'Could not load referral details. Please refresh and try again.';
    });
  }

  elCopyBtn.addEventListener('click', copyLink);
  elShareBtn.addEventListener('click', nativeShare);

  load();
})();
