(function () {
  'use strict';

(function() {
  'use strict';

  // ── Auth ──────────────────────────────────────────────────────────
  var AUTH;
  AUTH = ccAuth.getAuth();
  if (!AUTH || !AUTH.token) { window.location.href = '/learner/login.html'; return; }

  // ── State ─────────────────────────────────────────────────────────
  var CC = window.CC_COMPETENCY;
  var areaRatings = {};   // areaId -> 'struggled'|'ok'|'nailed'
  var skillRatings = {};  // skill_key -> 'struggled'|'ok'|'nailed'
  var expandedAreas = {}; // areaId -> true

  // ── Stepper helper ────────────────────────────────────────────────
  window.stepValue = function(id, delta) {
    var inp = document.getElementById(id);
    var v = parseInt(inp.value, 10) || 0;
    v = Math.max(parseInt(inp.min,10)||0, Math.min(parseInt(inp.max,10)||200, v + delta));
    inp.value = v;
  };

  // ── Radio / Toggle helpers ────────────────────────────────────────
  window.selectRadio = function(groupId, btn) {
    var btns = document.getElementById(groupId).querySelectorAll('.radio-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('selected');
    btn.classList.add('selected');
  };

  window.selectToggle = function(groupId, btn) {
    var btns = document.getElementById(groupId).querySelectorAll('.toggle-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('selected');
    btn.classList.add('selected');
  };

  window.toggleTestDate = function(show) {
    document.getElementById('testDateWrap').classList.toggle('hidden', !show);
  };

  // ── Step navigation ───────────────────────────────────────────────
  window.goToStep = function(step) {
    if (step === 3) buildSummary();
    document.getElementById('step1').classList.toggle('hidden', step !== 1);
    document.getElementById('step2').classList.toggle('hidden', step !== 2);
    document.getElementById('step3').classList.toggle('hidden', step !== 3);
    document.getElementById('successScreen').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Build Step 2 area cards ───────────────────────────────────────
  function buildAreaCards() {
    var container = document.getElementById('areaCards');
    var html = '';
    for (var a = 0; a < CC.AREAS.length; a++) {
      var area = CC.AREAS[a];
      var skills = CC.getSkillsByArea(area.id);
      var skillNames = [];
      for (var s = 0; s < skills.length; s++) skillNames.push(skills[s].label);

      html += '<div class="area-card" id="area-card-' + area.id + '">';
      html += '<div class="area-card-header">';
      html += '<div class="area-icon" style="background:' + area.colour + '20; color:' + area.colour + '">' + area.icon + '</div>';
      html += '<div class="area-info">';
      html += '<div class="area-name">' + area.label + '</div>';
      html += '<div class="area-skills-list">' + skillNames.join(', ') + '</div>';
      html += '</div>';
      html += '<div class="area-rating-btns">';
      for (var r = 0; r < CC.RATINGS.length; r++) {
        var rat = CC.RATINGS[r];
        html += '<button type="button" class="rating-btn" data-action="rate-area" data-area="' + area.id + '" data-rating="' + rat.key + '">';
        html += '<span class="rating-dot"></span>';
        html += '<span>' + rat.label + '</span>';
        html += '</button>';
      }
      html += '</div></div>';

      // Expansion for individual skills
      html += '<div class="area-expansion" id="expansion-' + area.id + '">';
      html += '<div class="area-expansion-inner">';
      for (var sk = 0; sk < skills.length; sk++) {
        html += '<div class="skill-row">';
        html += '<span class="skill-label">' + skills[sk].label + '</span>';
        html += '<div class="skill-rating-btns">';
        for (var sr = 0; sr < CC.RATINGS.length; sr++) {
          var srat = CC.RATINGS[sr];
          html += '<button type="button" class="skill-rating-btn" data-action="rate-skill" data-skill="' + skills[sk].key + '" data-rating="' + srat.key + '" title="' + srat.label + '">';
          html += '<span class="rating-dot"></span>';
          html += '</button>';
        }
        html += '</div></div>';
      }
      html += '</div></div></div>';
    }
    container.innerHTML = html;
  }

  // ── Rate an area ──────────────────────────────────────────────────
  window.rateArea = function(areaId, rating, btn) {
    areaRatings[areaId] = rating;

    // Update button selection
    var card = document.getElementById('area-card-' + areaId);
    var btns = card.querySelectorAll('.rating-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('selected');
    btn.classList.add('selected');

    // All skills inherit area rating
    var skills = CC.getSkillsByArea(areaId);
    for (var s = 0; s < skills.length; s++) {
      skillRatings[skills[s].key] = rating;
    }

    // Expand/collapse: only expand for "struggled"
    var expansion = document.getElementById('expansion-' + areaId);
    if (rating === 'struggled') {
      expandedAreas[areaId] = true;
      expansion.classList.add('open');
      // Pre-select all individual skill buttons to "struggled"
      var skillBtns = expansion.querySelectorAll('.skill-rating-btn');
      for (var sb = 0; sb < skillBtns.length; sb++) {
        skillBtns[sb].classList.remove('selected');
        if (skillBtns[sb].getAttribute('data-rating') === 'struggled') {
          skillBtns[sb].classList.add('selected');
        }
      }
    } else {
      expandedAreas[areaId] = false;
      expansion.classList.remove('open');
    }

    checkStep2Complete();
  };

  // ── Rate an individual skill ──────────────────────────────────────
  window.rateSkill = function(skillKey, rating, btn) {
    skillRatings[skillKey] = rating;
    // Update button selection within the row
    var row = btn.parentElement;
    var btns = row.querySelectorAll('.skill-rating-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('selected');
    btn.classList.add('selected');
  };

  function checkStep2Complete() {
    var allRated = true;
    for (var a = 0; a < CC.AREAS.length; a++) {
      if (!areaRatings[CC.AREAS[a].id]) { allRated = false; break; }
    }
    document.getElementById('step2Next').disabled = !allRated;
  }

  // ── Helpers to read form state ────────────────────────────────────
  function getSelectedValue(groupId) {
    var sel = document.getElementById(groupId).querySelector('.selected');
    return sel ? sel.getAttribute('data-value') : null;
  }

  function getFormData() {
    var testBooked = getSelectedValue('testBookedGroup') === 'yes';
    return {
      prior_hours_pro: parseInt(document.getElementById('hoursPro').value, 10) || 0,
      prior_hours_private: parseInt(document.getElementById('hoursPrivate').value, 10) || 0,
      previous_tests: parseInt(getSelectedValue('prevTestsGroup'), 10) || 0,
      transmission: getSelectedValue('transmissionGroup') || 'manual',
      test_booked: testBooked,
      test_date: testBooked ? (document.getElementById('testDate').value || null) : null,
      main_concerns: document.getElementById('mainConcerns').value.trim() || null
    };
  }

  function buildInitialRatings() {
    var ratings = [];
    for (var i = 0; i < CC.SKILLS.length; i++) {
      var sk = CC.SKILLS[i];
      ratings.push({
        skill_key: sk.key,
        rating: skillRatings[sk.key] || areaRatings[sk.area] || 'struggled'
      });
    }
    return ratings;
  }

  // ── Build summary (Step 3) ────────────────────────────────────────
  function buildSummary() {
    var fd = getFormData();
    var html = '<div class="summary-card"><div class="summary-section">';
    html += '<div class="summary-heading">Prior Experience</div>';
    html += '<div class="summary-row"><span class="label">Professional lessons</span><span class="value">' + fd.prior_hours_pro + ' hours</span></div>';
    html += '<div class="summary-row"><span class="label">Private practice</span><span class="value">' + fd.prior_hours_private + ' hours</span></div>';
    html += '<div class="summary-row"><span class="label">Previous tests</span><span class="value">' + fd.previous_tests + '</span></div>';
    html += '<div class="summary-row"><span class="label">Transmission</span><span class="value" style="text-transform:capitalize">' + fd.transmission + '</span></div>';
    if (fd.test_booked) {
      var dateStr = fd.test_date ? new Date(fd.test_date + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : 'Date not set';
      html += '<div class="summary-row"><span class="label">Test date</span><span class="value">' + dateStr + '</span></div>';
    }
    html += '</div>';

    if (fd.main_concerns) {
      html += '<div class="summary-section">';
      html += '<div class="summary-heading">Main Concerns</div>';
      html += '<div class="summary-concerns">"' + escHtml(fd.main_concerns) + '"</div>';
      html += '</div>';
    }

    html += '<div class="summary-section">';
    html += '<div class="summary-heading">Self-Assessment</div>';
    for (var a = 0; a < CC.AREAS.length; a++) {
      var area = CC.AREAS[a];
      var aRating = areaRatings[area.id];
      var rObj = getRatingObj(aRating);
      html += '<div class="summary-area-row">';
      html += '<span class="summary-dot" style="background:' + (rObj ? rObj.colour : '#ccc') + '"></span>';
      html += '<span class="summary-area-name">' + area.label + '</span>';
      html += '<span class="summary-area-label">' + (rObj ? rObj.label : 'Not rated') + '</span>';
      html += '</div>';

      // Show individual skills if area was expanded
      if (expandedAreas[area.id]) {
        var skills = CC.getSkillsByArea(area.id);
        for (var s = 0; s < skills.length; s++) {
          var skRating = skillRatings[skills[s].key] || aRating;
          var skObj = getRatingObj(skRating);
          html += '<div class="summary-skill-item">';
          html += '<span class="summary-dot" style="background:' + (skObj ? skObj.colour : '#ccc') + '"></span>';
          html += '<span>' + skills[s].label + '</span>';
          html += '</div>';
        }
      }
    }
    html += '</div></div>';

    document.getElementById('summaryContent').innerHTML = html;
  }

  function getRatingObj(key) {
    for (var i = 0; i < CC.RATINGS.length; i++) {
      if (CC.RATINGS[i].key === key) return CC.RATINGS[i];
    }
    return null;
  }

  function escHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Save profile ──────────────────────────────────────────────────
  window.saveProfile = function() {
    var btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    var fd = getFormData();
    fd.initial_ratings = buildInitialRatings();

    ccAuth.fetchAuthed('/api/learner?action=onboarding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'},
      body: JSON.stringify(fd)
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Save failed');
      return res.json();
    })
    .then(function() {
      if (window.posthog) {
        posthog.capture('onboarding_completed', {
          prior_hours_pro: fd.prior_hours_pro,
          prior_hours_private: fd.prior_hours_private,
          previous_tests: fd.previous_tests,
          transmission: fd.transmission,
          test_booked: fd.test_booked
        });
      }
      showSuccess();
    })
    .catch(function(err) {
      console.error('Save error:', err);
      btn.disabled = false;
      btn.textContent = 'Save Profile';
      alert('Something went wrong — please try again.');
    });
  };

  function showSuccess() {
    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');
    document.getElementById('successScreen').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Load existing data ────────────────────────────────────────────
  function loadExisting() {
    var overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');

    ccAuth.fetchAuthed('/api/learner?action=onboarding')
    .then(function(res) {
      if (!res.ok) throw new Error('Not found');
      return res.json();
    })
    .then(function(data) {
      if (!data || (!data.prior_hours_pro && !data.initial_ratings)) {
        overlay.classList.add('hidden');
        return;
      }
      populateForm(data);
      overlay.classList.add('hidden');
    })
    .catch(function() {
      overlay.classList.add('hidden');
    });
  }

  function populateForm(data) {
    if (data.prior_hours_pro != null) document.getElementById('hoursPro').value = data.prior_hours_pro;
    if (data.prior_hours_private != null) document.getElementById('hoursPrivate').value = data.prior_hours_private;

    if (data.previous_tests != null) {
      var val = data.previous_tests >= 3 ? '3' : String(data.previous_tests);
      var radios = document.getElementById('prevTestsGroup').querySelectorAll('.radio-btn');
      for (var i = 0; i < radios.length; i++) {
        radios[i].classList.remove('selected');
        if (radios[i].getAttribute('data-value') === val) radios[i].classList.add('selected');
      }
    }

    if (data.transmission) {
      var toggles = document.getElementById('transmissionGroup').querySelectorAll('.toggle-btn');
      for (var t = 0; t < toggles.length; t++) {
        toggles[t].classList.remove('selected');
        if (toggles[t].getAttribute('data-value') === data.transmission) toggles[t].classList.add('selected');
      }
    }

    if (data.test_booked) {
      var bookToggles = document.getElementById('testBookedGroup').querySelectorAll('.toggle-btn');
      for (var b = 0; b < bookToggles.length; b++) {
        bookToggles[b].classList.remove('selected');
        if (bookToggles[b].getAttribute('data-value') === 'yes') bookToggles[b].classList.add('selected');
      }
      toggleTestDate(true);
      if (data.test_date) document.getElementById('testDate').value = data.test_date;
    }

    if (data.main_concerns) document.getElementById('mainConcerns').value = data.main_concerns;

    // Restore ratings
    if (data.initial_ratings && data.initial_ratings.length > 0) {
      // First set all skill ratings from saved data
      for (var r = 0; r < data.initial_ratings.length; r++) {
        skillRatings[data.initial_ratings[r].skill_key] = data.initial_ratings[r].rating;
      }

      // Determine area-level ratings: if all skills in area share same rating, use that
      for (var a = 0; a < CC.AREAS.length; a++) {
        var area = CC.AREAS[a];
        var skills = CC.getSkillsByArea(area.id);
        var firstRating = skillRatings[skills[0].key];
        var allSame = true;
        for (var s = 1; s < skills.length; s++) {
          if (skillRatings[skills[s].key] !== firstRating) { allSame = false; break; }
        }

        if (allSame && firstRating) {
          areaRatings[area.id] = firstRating;
          // Select the area-level button
          var aBtn = document.querySelector('#area-card-' + area.id + ' .rating-btn[data-rating="' + firstRating + '"]');
          if (aBtn) aBtn.classList.add('selected');

          // If struggled, expand and show individual selections
          if (firstRating === 'struggled') {
            expandedAreas[area.id] = true;
            document.getElementById('expansion-' + area.id).classList.add('open');
            for (var es = 0; es < skills.length; es++) {
              var esBtn = document.querySelector('#expansion-' + area.id + ' .skill-rating-btn[data-skill="' + skills[es].key + '"][data-rating="' + (skillRatings[skills[es].key] || 'struggled') + '"]');
              if (esBtn) esBtn.classList.add('selected');
            }
          }
        } else {
          // Mixed ratings — set as struggled area and expand
          areaRatings[area.id] = 'struggled';
          expandedAreas[area.id] = true;
          var mixBtn = document.querySelector('#area-card-' + area.id + ' .rating-btn[data-rating="struggled"]');
          if (mixBtn) mixBtn.classList.add('selected');
          document.getElementById('expansion-' + area.id).classList.add('open');
          for (var ms = 0; ms < skills.length; ms++) {
            var msRat = skillRatings[skills[ms].key] || 'struggled';
            var msBtn = document.querySelector('#expansion-' + area.id + ' .skill-rating-btn[data-skill="' + skills[ms].key + '"][data-rating="' + msRat + '"]');
            if (msBtn) msBtn.classList.add('selected');
          }
        }
      }
      checkStep2Complete();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────
  buildAreaCards();
  loadExisting();
})();

document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'rate-area') rateArea(target.dataset.area, target.dataset.rating, target);
  else if (action === 'rate-skill') rateSkill(target.dataset.skill, target.dataset.rating, target);
});
(function wire() {
  document.querySelectorAll('[data-stepper]').forEach(function (btn) {
    btn.addEventListener('click', function () { stepValue(btn.dataset.stepper, parseInt(btn.dataset.delta, 10)); });
  });
  document.querySelectorAll('[data-radio-group]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectRadio(btn.dataset.radioGroup, btn); });
  });
  document.querySelectorAll('[data-toggle-group]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectToggle(btn.dataset.toggleGroup, btn);
      if (btn.dataset.testDate != null) toggleTestDate(btn.dataset.testDate === 'true');
    });
  });
  document.querySelectorAll('[data-goto-step]').forEach(function (btn) {
    btn.addEventListener('click', function () { goToStep(parseInt(btn.dataset.gotoStep, 10)); });
  });
  var saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveProfile);
})();
})();
