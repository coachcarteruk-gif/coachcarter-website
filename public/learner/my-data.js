(function () {
  'use strict';

  var auth = window.ccAuth && ccAuth.getAuth();
  if (!auth) {
    document.getElementById('content').innerHTML =
      '<div class="error-msg">Please <a href="/learner/login.html?redirect=/learner/my-data.html">log in</a> to view your data.</div>';
    return;
  }

  ccAuth.fetchAuthed('/api/learner?action=export-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) {
        document.getElementById('content').innerHTML = '<div class="error-msg">' + esc(data.error) + '</div>';
        return;
      }
      renderData(data);
    })
    .catch(function () {
      document.getElementById('content').innerHTML =
        '<div class="error-msg">Failed to load your data. Please try again later.</div>';
    });

  function renderData(d) {
    var html = '';

    // Profile
    var p = d.profile || {};
    html += '<h2>Profile</h2><div class="data-section">';
    html += row('Name', p.name);
    html += row('Email', p.email);
    html += row('Phone', p.phone);
    html += row('Pickup address', p.pickup_address);
    html += row('Test date', formatDate(p.test_date));
    html += row('Test time', p.test_time);
    html += row('Contact before lessons', p.prefer_contact_before ? 'Yes' : 'No');
    html += row('Account created', formatDateTime(p.created_at));
    html += row('Last active', formatDateTime(p.last_activity_at));
    html += '</div>';

    // Onboarding
    if (d.onboarding) {
      var o = d.onboarding;
      html += '<h2>Onboarding</h2><div class="data-section">';
      html += row('Professional hours', o.prior_hours_pro);
      html += row('Private practice hours', o.prior_hours_private);
      html += row('Previous tests', o.previous_tests);
      html += row('Transmission', o.transmission);
      html += row('Test date', formatDate(o.test_date));
      html += row('Main concerns', o.main_concerns);
      html += '</div>';
    }

    // Bookings
    html += '<h2>Bookings (' + (d.bookings || []).length + ')</h2>';
    if (d.bookings && d.bookings.length) {
      html += '<div class="data-section"><table class="data-table"><thead><tr><th>Date</th><th>Time</th><th>Instructor</th><th>Type</th><th>Status</th><th>Pickup</th></tr></thead><tbody>';
      d.bookings.forEach(function (b) {
        html += '<tr><td>' + esc(formatDate(b.scheduled_date)) + '</td><td>' + esc(b.start_time || '') + ' - ' + esc(b.end_time || '') + '</td><td>' + esc(b.instructor_name || '-') + '</td><td>' + esc(b.lesson_type || '-') + '</td><td>' + esc(b.status || '') + '</td><td>' + esc(b.pickup_address || '-') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else { html += '<div class="data-empty">No bookings</div>'; }

    // Transactions
    html += '<h2>Credit Transactions (' + (d.transactions || []).length + ')</h2>';
    if (d.transactions && d.transactions.length) {
      html += '<div class="data-section"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Credits</th><th>Minutes</th><th>Amount</th><th>Method</th></tr></thead><tbody>';
      d.transactions.forEach(function (t) {
        html += '<tr><td>' + esc(formatDateTime(t.created_at)) + '</td><td>' + esc(t.type || '') + '</td><td>' + esc(t.credits || 0) + '</td><td>' + esc(t.minutes || 0) + '</td><td>' + esc(formatPence(t.amount_pence)) + '</td><td>' + esc(t.payment_method || '-') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else { html += '<div class="data-empty">No transactions</div>'; }

    // Driving Sessions
    html += '<h2>Driving Sessions (' + (d.driving_sessions || []).length + ')</h2>';
    if (d.driving_sessions && d.driving_sessions.length) {
      html += '<div class="data-section"><table class="data-table"><thead><tr><th>Date</th><th>Duration</th><th>Type</th><th>Notes</th></tr></thead><tbody>';
      d.driving_sessions.forEach(function (s) {
        html += '<tr><td>' + esc(formatDate(s.session_date)) + '</td><td>' + esc(s.duration_minutes || 0) + ' min</td><td>' + esc(s.session_type || '') + '</td><td>' + esc(s.notes || '-') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else { html += '<div class="data-empty">No sessions logged</div>'; }

    // Skill Ratings
    html += '<h2>Skill Ratings (' + (d.skill_ratings || []).length + ')</h2>';
    if (d.skill_ratings && d.skill_ratings.length) {
      html += '<div class="data-section"><table class="data-table"><thead><tr><th>Skill</th><th>Rating</th><th>Note</th><th>Date</th></tr></thead><tbody>';
      d.skill_ratings.forEach(function (s) {
        html += '<tr><td>' + esc(s.skill_key || '') + '</td><td>' + esc(s.rating || '') + '</td><td>' + esc(s.note || '-') + '</td><td>' + esc(formatDateTime(s.created_at)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else { html += '<div class="data-empty">No skill ratings</div>'; }

    // Quiz Results
    html += '<h2>Quiz Results (' + (d.quiz_results || []).length + ')</h2>';
    if (d.quiz_results && d.quiz_results.length) {
      html += '<div class="data-section"><table class="data-table"><thead><tr><th>Question</th><th>Your Answer</th><th>Correct Answer</th><th>Result</th><th>Date</th></tr></thead><tbody>';
      d.quiz_results.forEach(function (q) {
        html += '<tr><td>' + esc(q.question_id || '') + '</td><td>' + esc(q.learner_answer || '-') + '</td><td>' + esc(q.correct_answer || '-') + '</td><td>' + (q.correct ? 'Correct' : 'Incorrect') + '</td><td>' + esc(formatDateTime(q.answered_at)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else { html += '<div class="data-empty">No quiz results</div>'; }

    // Mock Tests
    html += '<h2>Mock Tests (' + (d.mock_tests || []).length + ')</h2>';
    if (d.mock_tests && d.mock_tests.length) {
      html += '<div class="data-section"><table class="data-table"><thead><tr><th>Date</th><th>Result</th><th>Driving</th><th>Serious</th><th>Dangerous</th><th>Notes</th></tr></thead><tbody>';
      d.mock_tests.forEach(function (m) {
        html += '<tr><td>' + esc(formatDateTime(m.started_at)) + '</td><td>' + esc(m.result || '-') + '</td><td>' + esc(m.total_driving_faults || 0) + '</td><td>' + esc(m.total_serious_faults || 0) + '</td><td>' + esc(m.total_dangerous_faults || 0) + '</td><td>' + esc(m.notes || '-') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else { html += '<div class="data-empty">No mock tests</div>'; }

    // Metadata
    html += '<h2>Export Information</h2><div class="data-section">';
    html += row('Exported at', formatDateTime(d._metadata.exported_at));
    html += row('Data categories', (d._metadata.data_categories || []).join(', '));
    html += '</div>';

    document.getElementById('content').innerHTML = html;
  }

  function row(label, value) {
    return '<div class="data-row"><span class="data-label">' + esc(label) + '</span><span class="data-value">' + esc(value || '-') + '</span></div>';
  }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDateTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function formatPence(p) {
    if (!p) return '-';
    return '\u00A3' + (p / 100).toFixed(2);
  }
})();
