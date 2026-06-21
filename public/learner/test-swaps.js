(function () {
  'use strict';

  var state = null;
  var windows = [{ start_date: '', end_date: '' }];
  var unavailableDates = [];

  window.addEventListener('DOMContentLoaded', function () {
    if (!window.ccAuth || !window.ccAuth.requireAuth()) return;
    bind();
    drawForm();
    loadSummary();
  });

  function bind() {
    byId('btnRefresh')?.addEventListener('click', loadSummary);
    byId('btnAddWindow')?.addEventListener('click', function () {
      windows.push({ start_date: '', end_date: '' });
      drawForm();
    });
    byId('btnAddUnavailable')?.addEventListener('click', function () {
      unavailableDates.push('');
      drawForm();
    });
    byId('btnCreateListing')?.addEventListener('click', createListing);
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var action = t.dataset.action;
      if (action === 'remove-window') {
        windows.splice(parseInt(t.dataset.idx, 10), 1);
        if (!windows.length) windows.push({ start_date: '', end_date: '' });
        drawForm();
      } else if (action === 'remove-unavailable') {
        unavailableDates.splice(parseInt(t.dataset.idx, 10), 1);
        drawForm();
      } else if (action === 'request-listing') {
        requestListing(parseInt(t.dataset.id, 10), t);
      } else if (action === 'delete-listing') {
        deleteListing(parseInt(t.dataset.id, 10), t);
      } else if (action === 'accept-request') {
        acceptRequest(parseInt(t.dataset.id, 10), t);
      } else if (action === 'decline-request') {
        declineRequest(parseInt(t.dataset.id, 10), t);
      } else if (action === 'withdraw-request') {
        withdrawRequest(parseInt(t.dataset.id, 10), t);
      }
    });
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.windowField) {
        var idx = parseInt(t.dataset.idx, 10);
        windows[idx][t.dataset.windowField] = t.value;
      } else if (t.dataset.unavailableIdx) {
        unavailableDates[parseInt(t.dataset.unavailableIdx, 10)] = t.value;
      }
    });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '-';
    var d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function fmtTime(timeStr) {
    return timeStr ? String(timeStr).slice(0, 5) : '-';
  }

  function statusLabel(status) {
    return String(status || '').replace(/_/g, ' ');
  }

  function testGrid(date, time, centre) {
    return '<div class="grid">' +
      '<div class="kv"><div class="kv-label">Date</div><div class="kv-value">' + esc(fmtDate(date)) + '</div></div>' +
      '<div class="kv"><div class="kv-label">Time</div><div class="kv-value">' + esc(fmtTime(time)) + '</div></div>' +
      '<div class="kv"><div class="kv-label">Centre</div><div class="kv-value">' + esc(centre || '-') + '</div></div>' +
    '</div>';
  }

  function chipsForListing(listing) {
    var html = '<div class="chip-row">';
    (listing.windows || []).forEach(function (w) {
      html += '<span class="chip">' + esc(fmtDate(w.start_date)) + ' to ' + esc(fmtDate(w.end_date)) + '</span>';
    });
    (listing.unavailable_dates || []).forEach(function (d) {
      html += '<span class="chip gray">Unavailable ' + esc(fmtDate(d)) + '</span>';
    });
    html += '</div>';
    return html;
  }

  async function loadSummary() {
    setBody('incomingBody', '<div class="empty">Loading...</div>');
    try {
      var res = await ccAuth.fetchAuthed('/api/test-swaps?action=summary');
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || 'Failed to load test swaps');
      state = data;
      render();
    } catch (err) {
      var msg = '<div class="empty">Failed to load test swaps. ' + esc(err.message || '') + '</div>';
      setBody('incomingBody', msg);
      setBody('myListingBody', msg);
      setBody('marketBody', msg);
      setBody('myRequestsBody', msg);
      console.error('load test swaps:', err);
    }
  }

  function setBody(id, html) {
    var el = byId(id);
    if (el) el.innerHTML = html;
  }

  function render() {
    if (!state) return;
    var prompt = byId('profilePrompt');
    if (prompt) prompt.style.display = state.eligible ? 'none' : 'block';
    var createSection = byId('createSection');
    if (createSection) createSection.style.display = state.eligible && !state.my_listing ? 'block' : 'none';
    var sub = byId('marketSubtitle');
    if (sub && state.profile?.test_centre) sub.textContent = 'Showing active listings at ' + state.profile.test_centre + '.';

    renderIncoming();
    renderMyListing();
    renderMarket();
    renderMyRequests();
  }

  function renderIncoming() {
    var rows = state.incoming_requests || [];
    if (!rows.length) {
      setBody('incomingBody', '<div class="empty">No incoming test swap requests yet.</div>');
      return;
    }
    setBody('incomingBody', '<div class="cards">' + rows.map(function (r) {
      var actions = '';
      if (r.status === 'pending' && r.listing_status === 'active') {
        actions = '<div class="actions">' +
          '<button class="btn primary" data-action="accept-request" data-id="' + r.id + '">Accept</button>' +
          '<button class="btn" data-action="decline-request" data-id="' + r.id + '">Decline</button>' +
        '</div>';
      }
      return '<div class="swap-card is-alert">' +
        '<div class="swap-title">Request: ' + esc(statusLabel(r.status)) + '</div>' +
        testGrid(r.requester_test_date_snapshot, r.requester_test_time_snapshot, r.requester_test_centre_snapshot) +
        '<div class="chip-row"><span class="chip gray">Requested ' + esc(fmtDate(String(r.created_at || '').slice(0, 10))) + '</span></div>' +
        actions +
      '</div>';
    }).join('') + '</div>');
  }

  function renderMyListing() {
    var listing = state.my_listing;
    if (!listing) {
      if (!state.eligible) {
        setBody('myListingBody', '<div class="empty">Add your official test details to create a listing.</div>');
      } else {
        setBody('myListingBody', '<div class="empty">You do not have an active listing yet. Add replacement windows below to post your test.</div>');
      }
      return;
    }
    var deleteBtn = listing.status === 'active'
      ? '<button class="btn danger" data-action="delete-listing" data-id="' + listing.id + '">Delete listing</button>'
      : '';
    setBody('myListingBody',
      '<div class="swap-card">' +
        '<div class="swap-title">Your listing is ' + esc(statusLabel(listing.status)) + '</div>' +
        testGrid(listing.test_date, listing.test_time, listing.test_centre) +
        chipsForListing(listing) +
        '<div class="actions">' + deleteBtn + '</div>' +
      '</div>');
  }

  function renderMarket() {
    var rows = state.listings || [];
    if (!state.eligible) {
      setBody('marketBody', '<div class="empty">Add your official test details before browsing matching swaps.</div>');
      return;
    }
    if (!rows.length) {
      setBody('marketBody', '<div class="empty">No active same-centre listings match your saved test details yet.</div>');
      return;
    }
    setBody('marketBody', '<div class="cards">' + rows.map(function (l) {
      var action = '';
      if (l.has_open_request) {
        action = '<span class="status">Request ' + esc(statusLabel(l.my_request_status || 'pending')) + '</span>';
      } else {
        action = '<button class="btn primary" data-action="request-listing" data-id="' + l.id + '">Request this slot</button>';
      }
      return '<div class="swap-card">' +
        '<div class="swap-title">Offered test</div>' +
        testGrid(l.test_date, l.test_time, l.test_centre) +
        chipsForListing(l) +
        '<div class="actions">' + action + '</div>' +
      '</div>';
    }).join('') + '</div>');
  }

  function renderMyRequests() {
    var rows = state.my_requests || [];
    if (!rows.length) {
      setBody('myRequestsBody', '<div class="empty">You have not requested any swaps yet.</div>');
      return;
    }
    setBody('myRequestsBody', '<div class="cards">' + rows.map(function (r) {
      var actions = r.status === 'pending'
        ? '<div class="actions"><button class="btn" data-action="withdraw-request" data-id="' + r.id + '">Withdraw</button></div>'
        : '';
      return '<div class="swap-card">' +
        '<div class="swap-title">Request ' + esc(statusLabel(r.status)) + '</div>' +
        testGrid(r.offered_test_date, r.offered_test_time, r.offered_test_centre) +
        '<div class="chip-row"><span class="chip gray">Your offered date ' + esc(fmtDate(r.requester_test_date_snapshot)) + '</span></div>' +
        actions +
      '</div>';
    }).join('') + '</div>');
  }

  function drawForm() {
    var windowsList = byId('windowsList');
    if (windowsList) {
      windowsList.innerHTML = windows.map(function (w, idx) {
        return '<div class="form-grid">' +
          '<div class="field"><label>Start date</label><input type="date" data-window-field="start_date" data-idx="' + idx + '" value="' + esc(w.start_date) + '"></div>' +
          '<div class="field"><label>End date</label><input type="date" data-window-field="end_date" data-idx="' + idx + '" value="' + esc(w.end_date) + '"></div>' +
          '<button class="btn danger" data-action="remove-window" data-idx="' + idx + '" type="button">Remove</button>' +
        '</div>';
      }).join('');
    }
    var unavailableList = byId('unavailableList');
    if (unavailableList) {
      unavailableList.innerHTML = unavailableDates.length
        ? unavailableDates.map(function (d, idx) {
            return '<div class="form-grid">' +
              '<div class="field"><label>Unavailable date</label><input type="date" data-unavailable-idx="' + idx + '" value="' + esc(d) + '"></div>' +
              '<div></div><button class="btn danger" data-action="remove-unavailable" data-idx="' + idx + '" type="button">Remove</button>' +
            '</div>';
          }).join('')
        : '<div class="empty">No unavailable dates added.</div>';
    }
  }

  function setStatus(id, message, type) {
    var el = byId(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'status' + (type ? ' ' + type : '');
  }

  async function post(action, body) {
    var res = await ccAuth.fetchAuthed('/api/test-swaps?action=' + encodeURIComponent(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || 'Request failed');
    return data;
  }

  async function createListing() {
    setStatus('createStatus', 'Saving...', '');
    var cleanWindows = windows.filter(function (w) { return w.start_date && w.end_date; });
    var cleanUnavailable = unavailableDates.filter(Boolean);
    try {
      await post('create-listing', { windows: cleanWindows, unavailable_dates: cleanUnavailable });
      windows = [{ start_date: '', end_date: '' }];
      unavailableDates = [];
      drawForm();
      setStatus('createStatus', 'Listing created.', 'ok');
      await loadSummary();
    } catch (err) {
      setStatus('createStatus', err.message || 'Failed to create listing', 'error');
    }
  }

  async function requestListing(id, btn) {
    await mutateButton(btn, 'Requesting...', function () { return post('request-listing', { listing_id: id }); });
  }

  async function deleteListing(id, btn) {
    if (!confirm('Delete your active test swap listing? Pending requests will be declined.')) return;
    await mutateButton(btn, 'Deleting...', function () { return post('delete-listing', { listing_id: id }); });
  }

  async function acceptRequest(id, btn) {
    if (!confirm('Accept this swap in principle? Admin will see both learner contact details to coordinate it.')) return;
    await mutateButton(btn, 'Accepting...', function () { return post('accept-request', { request_id: id }); });
  }

  async function declineRequest(id, btn) {
    await mutateButton(btn, 'Declining...', function () { return post('decline-request', { request_id: id }); });
  }

  async function withdrawRequest(id, btn) {
    await mutateButton(btn, 'Withdrawing...', function () { return post('withdraw-request', { request_id: id }); });
  }

  async function mutateButton(btn, label, fn) {
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try {
      await fn();
      await loadSummary();
    } catch (err) {
      alert(err.message || 'Action failed');
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }
})();
