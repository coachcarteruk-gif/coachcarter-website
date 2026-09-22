(function () {
  'use strict';
  var root = document.getElementById('freeTrialVideo');
  var query = new URLSearchParams(location.search);
  var school = query.get('school');
  // This is CoachCarter's introduction, not shared branding for other schools.
  var coachCarterHost = ['coachcarter.uk', 'www.coachcarter.uk', 'localhost', '127.0.0.1'].includes(location.hostname) ||
    /^coachcarter-website(?:-[a-z0-9-]+)?\.vercel\.app$/.test(location.hostname);
  if (!root || !coachCarterHost ||
      (school && school !== 'coachcarter') || (query.has('school_id') && query.get('school_id') !== '1')) return;

  window.ccTrialMediaVersion = 'text_v1';
  window.ccTrialMediaPending = true;
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 2500);
  function localAsset(value, extension) {
    return typeof value === 'string' && new RegExp('^/media/free-trial/[a-z0-9-]+\\.' + extension + '$').test(value);
  }
  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function mount(media) {
    if (!media || media.enabled !== true || media.version !== 'video_v1' ||
        !/^[a-f0-9]{32}$/.test(media.stream_id) || !localAsset(media.poster, 'jpg') ||
        !localAsset(media.transcript_src, 'txt')) return;

    var heading = element('h2', 'A quick introduction from Fraser');
    heading.id = 'trialVideoHeading';
    var intro = element('p', '2 min 13 sec · Watch when you’re ready, or go straight to the questions.');
    var frame = element('div', '', 'trial-video-frame');
    var play = element('button', '', 'trial-video-play');
    play.type = 'button';
    play.setAttribute('aria-label', 'Play free trial introduction from Fraser');
    var poster = element('img');
    poster.src = media.poster;
    poster.alt = '';
    poster.width = 800;
    poster.height = 800;
    play.append(poster, element('span', 'Watch introduction'));
    frame.appendChild(play);
    var links = element('div', '', 'trial-video-links');
    var skip = element('a', 'Go straight to the questions');
    skip.href = '#trial-start';
    var transcript = element('a', 'Read the transcript');
    transcript.href = media.transcript_src;
    transcript.target = '_blank';
    transcript.rel = 'noopener';
    links.append(skip, transcript);
    var note = element('p', 'Your test is more than four months away, or not booked yet? You can still complete the questions below — we’ll show you the right trial route.', 'trial-video-note');
    var help = element('p', 'If the player doesn’t start, you can read the transcript or continue with the questions.', 'trial-video-help');
    help.hidden = true;
    play.addEventListener('click', function () {
      var player = element('iframe');
      player.title = 'Free trial introduction from Fraser';
      // Only this user click contacts Stream. Autoplay here starts the requested
      // playback; the landing page itself never loads or autoplays a video.
      player.src = 'https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/' + media.stream_id + '/iframe?autoplay=true&defaultTextTrack=en';
      player.allow = 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen';
      player.allowFullscreen = true;
      frame.replaceChildren(player);
      player.focus();
      help.hidden = false;
    });
    root.append(heading, intro, frame, links, note, help);
    root.hidden = false;
    window.ccTrialMediaVersion = 'video_v1';
  }
  fetch('/content/free-trial-vsl.json', { cache: 'no-store', signal: controller.signal })
    .then(function (response) { if (!response.ok) throw new Error('media unavailable'); return response.json(); })
    .then(mount)
    .catch(function () { /* Optional media must never block the questionnaire. */ })
    .finally(function () {
      clearTimeout(timeout);
      window.ccTrialMediaPending = false;
      document.dispatchEvent(new CustomEvent('cc-trial-media-ready'));
    });
}());
