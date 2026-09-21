(function () {
  'use strict';
  var school = new URLSearchParams(location.search).get('school');
  var scope = school && /^[a-z0-9-]+$/.test(school) ? '&school=' + encodeURIComponent(school) : '';
  if (scope) document.querySelectorAll('a[href^="/free?"]').forEach(function (a) { a.href += scope; });
  // Static .html access has the same fail-closed gate as the clean server route.
  fetch('/api/schools?action=public-config' + scope).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (c) {
    if (c.test_date_trial_funnel_enabled !== true) location.replace('/freetrial' + (scope ? '?' + scope.slice(1) : ''));
  }).catch(function () { location.replace('/freetrial'); });
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 2500);
  window.ccTrialMediaVersion = 'text_v1';
  fetch('/content/test-booked-vsl.json', { signal: controller.signal }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (m) {
    if (m.enabled !== true || m.version !== 'video_v1') return;
    if (![m.src, m.poster, m.captions_src, m.transcript_src].every(function (s) { return typeof s === 'string' && /^\/media\/test-booked\/[a-zA-Z0-9_./-]+$/.test(s) && !s.includes('..'); })) return;
    window.ccTrialMediaVersion = 'video_v1';
    var mount = document.getElementById('videoMount');
    var video = document.createElement('video');
    video.controls = true; video.playsInline = true; video.preload = 'none'; video.src = m.src; video.poster = m.poster;
    video.setAttribute('aria-label', 'What to expect from your free lesson');
    var captions = document.createElement('track'); captions.kind = 'captions'; captions.srclang = 'en'; captions.label = 'English'; captions.src = m.captions_src; captions.default = true; video.appendChild(captions);
    var transcript = document.createElement('a'); transcript.href = m.transcript_src; transcript.textContent = 'Read the video transcript';
    mount.append(video, transcript); mount.hidden = false; document.getElementById('videoFallback').hidden = true;
    video.addEventListener('error', function () { mount.hidden = true; document.getElementById('videoFallback').hidden = false; });
    document.querySelectorAll('[data-trial-placement]').forEach(function (a) { a.href += '&content=video_v1'; });
  }).catch(function () { /* Useful text and booking links are always present. */ }).finally(function () {
    clearTimeout(timeout); window.ccTrialMediaReady = true; document.dispatchEvent(new Event('cc-trial-media-ready'));
  });
}());
