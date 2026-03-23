/**
 * CoachCarter Competency Framework
 * ─────────────────────────────────
 * Single source of truth for the 17 DL25-aligned driving skills
 * used across Log Session, Examiner Quiz, Mock Test, My Progress,
 * and Ask the Examiner AI.
 *
 * Every feature imports this file via <script src="/competency-config.js">
 * so wording, grouping, and skill keys are always consistent.
 */
window.CC_COMPETENCY = (function () {
  'use strict';

  // ── 5 Competency Areas ─────────────────────────────────────────
  var AREAS = [
    { id: 'vehicle_control',     label: 'Vehicle Control',       icon: '🚗', colour: '#6366f1' },
    { id: 'awareness_planning',  label: 'Awareness & Planning',  icon: '👁️', colour: '#0ea5e9' },
    { id: 'road_positioning',    label: 'Road Positioning',      icon: '🛣️', colour: '#8b5cf6' },
    { id: 'decision_making',     label: 'Decision Making',       icon: '⚡', colour: '#f59e0b' },
    { id: 'manoeuvres',          label: 'Manoeuvres',            icon: '🅿️', colour: '#10b981' }
  ];

  // ── 17 Skills (DL25-aligned) ───────────────────────────────────
  //
  //  key          – unique identifier, stored in DB (skill_ratings.skill_key)
  //  label        – plain-English name shown to learner
  //  dl25         – official DL25 reference code
  //  dl25Label    – official DL25 category name
  //  area         – parent competency area id
  //  description  – one-liner shown in tooltips / AI context
  //
  var SKILLS = [
    // ── Vehicle Control ──────────────────────────────────────────
    { key: 'accelerator_12a', label: 'Accelerator',     dl25: '12a', dl25Label: 'Control — Accelerator',
      area: 'vehicle_control',
      description: 'Smooth, progressive use of the accelerator without jerking or fuel waste' },
    { key: 'clutch_12b',      label: 'Clutch',          dl25: '12b', dl25Label: 'Control — Clutch',
      area: 'vehicle_control',
      description: 'Smooth clutch operation, correct bite-point control, no riding the clutch' },
    { key: 'gears_12c',       label: 'Gears',           dl25: '12c', dl25Label: 'Control — Gears',
      area: 'vehicle_control',
      description: 'Appropriate gear selection for road/speed conditions, smooth changes' },
    { key: 'footbrake_12d',   label: 'Footbrake',       dl25: '12d', dl25Label: 'Control — Footbrake',
      area: 'vehicle_control',
      description: 'Progressive braking without harshness, appropriate stopping distances' },
    { key: 'parking_brake_12e', label: 'Parking Brake', dl25: '12e', dl25Label: 'Control — Parking Brake',
      area: 'vehicle_control',
      description: 'Correct use of parking brake — applying when needed, releasing before move-off' },
    { key: 'steering_12f',    label: 'Steering',         dl25: '12f', dl25Label: 'Control — Steering',
      area: 'vehicle_control',
      description: 'Smooth steering inputs, correct hand positioning, no arm-crossing on turns' },

    // ── Awareness & Planning ─────────────────────────────────────
    { key: 'mirrors_14',      label: 'Use of Mirrors',    dl25: '14', dl25Label: 'Use of Mirrors',
      area: 'awareness_planning',
      description: 'Checking mirrors before signalling, changing direction, speed, or lane' },
    { key: 'signals_15',      label: 'Signals',           dl25: '15', dl25Label: 'Signals',
      area: 'awareness_planning',
      description: 'Timely, correct signals — not too early, late, or misleading' },
    { key: 'awareness_26',    label: 'Awareness & Planning', dl25: '26', dl25Label: 'Awareness / Planning',
      area: 'awareness_planning',
      description: 'Anticipating hazards, planning ahead, defensive driving awareness' },
    { key: 'signs_signals_17', label: 'Signs & Signals', dl25: '17', dl25Label: 'Response to Signs / Signals',
      area: 'awareness_planning',
      description: 'Correct response to traffic lights, road signs, markings, and signals' },

    // ── Road Positioning ─────────────────────────────────────────
    { key: 'positioning_23',  label: 'Positioning',       dl25: '23', dl25Label: 'Positioning',
      area: 'road_positioning',
      description: 'Correct lane positioning for road layout, turns, and traffic conditions' },
    { key: 'clearance_16',    label: 'Clearance',         dl25: '16', dl25Label: 'Clearance / Obstructions',
      area: 'road_positioning',
      description: 'Safe clearance around parked cars, cyclists, pedestrians, and obstructions' },
    { key: 'following_19',    label: 'Following Distance', dl25: '19', dl25Label: 'Following Distance',
      area: 'road_positioning',
      description: 'Maintaining safe stopping distance from the vehicle ahead' },

    // ── Decision Making ──────────────────────────────────────────
    { key: 'junctions_21',    label: 'Junctions',         dl25: '21', dl25Label: 'Junctions',
      area: 'decision_making',
      description: 'Correct approach, observation, and timing at junctions and roundabouts' },
    { key: 'judgement_22',    label: 'Judgement',          dl25: '22', dl25Label: 'Judgement',
      area: 'decision_making',
      description: 'Assessing gaps, speeds, and distances — overtaking, meeting traffic, crossroads' },
    { key: 'speed_18',        label: 'Use of Speed',       dl25: '18', dl25Label: 'Use of Speed',
      area: 'decision_making',
      description: 'Appropriate speed for road type, conditions, hazards, and limits' },
    { key: 'pedestrians_24',  label: 'Pedestrian Crossings', dl25: '24', dl25Label: 'Pedestrian Crossings',
      area: 'decision_making',
      description: 'Safe approach and response at all types of pedestrian crossings' },
    { key: 'progress_20',     label: 'Progress',           dl25: '20', dl25Label: 'Progress',
      area: 'decision_making',
      description: 'Making reasonable progress without unnecessary hesitation or delay' },

    // ── Manoeuvres ───────────────────────────────────────────────
    { key: 'controlled_stop_2', label: 'Controlled Stop', dl25: '2', dl25Label: 'Controlled Stop',
      area: 'manoeuvres',
      description: 'Emergency/controlled stop — firm, prompt, and under full control' },
    { key: 'reverse_right_4', label: 'Reverse Right',     dl25: '4', dl25Label: 'Reverse Right',
      area: 'manoeuvres',
      description: 'Pull up on the right, reverse two car lengths, rejoin traffic safely' },
    { key: 'reverse_park_5',  label: 'Reverse Park',      dl25: '5', dl25Label: 'Reverse Park',
      area: 'manoeuvres',
      description: 'Reverse parallel park — control, accuracy, observation throughout' },
    { key: 'forward_park_8',  label: 'Forward Park',      dl25: '8', dl25Label: 'Forward Park / Taxi',
      area: 'manoeuvres',
      description: 'Forward bay park — accurate positioning and safe approach' },
    { key: 'move_off_13',     label: 'Move Off',          dl25: '13', dl25Label: 'Move Off',
      area: 'manoeuvres',
      description: 'Moving off safely — flat, uphill, downhill, and at an angle' }
  ];

  // ── Fault Types ────────────────────────────────────────────────
  var FAULT_TYPES = [
    { key: 'driving',   label: 'Driving fault',   shortLabel: 'D',  colour: '#f59e0b', description: 'Not potentially dangerous, but shows a lapse in skill or knowledge' },
    { key: 'serious',   label: 'Serious fault',   shortLabel: 'S',  colour: '#ef4444', description: 'Potentially dangerous — could put someone at risk' },
    { key: 'dangerous', label: 'Dangerous fault',  shortLabel: '✕',  colour: '#991b1b', description: 'Involved actual danger to the examiner, candidate, public, or property' }
  ];

  // ── Traffic-Light Ratings (for lesson logs) ────────────────────
  var RATINGS = [
    { key: 'struggled', label: 'Needs work',    colour: '#ef4444', score: 1 },
    { key: 'ok',        label: 'Getting there',  colour: '#f58321', score: 2 },
    { key: 'nailed',    label: 'Confident',       colour: '#22c55e', score: 3 }
  ];

  // ── Mock Test Pass Criteria ────────────────────────────────────
  var MOCK_TEST = {
    maxDrivingFaults: 15,
    maxSeriousFaults: 0,
    maxDangerousFaults: 0,
    parts: [
      { number: 1, label: 'Part 1 — Urban & Residential', description: 'Moving off, junctions, mirrors, signals, speed in built-up areas', durationMinutes: 10 },
      { number: 2, label: 'Part 2 — Open Roads & Dual Carriageways', description: 'Speed management, following distance, positioning, overtaking', durationMinutes: 10 },
      { number: 3, label: 'Part 3 — Manoeuvres & Independent Driving', description: 'Reverse park, forward bay, awareness and planning under test conditions', durationMinutes: 10 }
    ]
  };

  // ── Legacy Skill Mapping ───────────────────────────────────────
  // Maps old log-session skill keys to their nearest new equivalents
  // so existing session history still renders correctly.
  var LEGACY_MAP = {
    speed_choice:  'speed_18',
    lane_choice:   'positioning_23',
    mirrors:       'mirrors_14',
    lane_keeping:  'positioning_23',
    stay_or_go:    'junctions_21',
    roundabouts:   'junctions_21',
    manoeuvres:    'move_off_13'
  };

  // ── Scenario-to-Skill Mapping ──────────────────────────────────
  // Maps examiner quiz dl25_ref prefixes to skill keys so quiz
  // results feed into the competency record.
  var QUIZ_DL25_MAP = {
    '2':   'controlled_stop_2',
    '4':   'reverse_right_4',
    '5':   'reverse_park_5',
    '7':   'awareness_26',       // Vehicle checks → awareness
    '8':   'forward_park_8',
    '11':  'awareness_26',       // Precautions → awareness
    '12a': 'accelerator_12a',
    '12b': 'clutch_12b',
    '12c': 'gears_12c',
    '12d': 'footbrake_12d',
    '12e': 'parking_brake_12e',
    '12f': 'steering_12f',
    '13':  'move_off_13',
    '14':  'mirrors_14',
    '15':  'signals_15',
    '16':  'clearance_16',
    '17':  'signs_signals_17',
    '18':  'speed_18',
    '19':  'following_19',
    '20':  'progress_20',
    '21':  'junctions_21',
    '22':  'judgement_22',
    '23':  'positioning_23',
    '24':  'pedestrians_24',
    '25':  'positioning_23',     // Normal stops → positioning
    '26':  'awareness_26',
    '27':  'awareness_26'        // Ancillary controls → awareness
  };

  // ── Helper Functions ───────────────────────────────────────────

  /** Get a skill by its key */
  function getSkill(key) {
    for (var i = 0; i < SKILLS.length; i++) {
      if (SKILLS[i].key === key) return SKILLS[i];
    }
    return null;
  }

  /** Get all skills in a competency area */
  function getSkillsByArea(areaId) {
    var result = [];
    for (var i = 0; i < SKILLS.length; i++) {
      if (SKILLS[i].area === areaId) result.push(SKILLS[i]);
    }
    return result;
  }

  /** Get the competency area object for a skill key */
  function getAreaForSkill(skillKey) {
    var skill = getSkill(skillKey);
    if (!skill) return null;
    for (var i = 0; i < AREAS.length; i++) {
      if (AREAS[i].id === skill.area) return AREAS[i];
    }
    return null;
  }

  /** Map a quiz scenario dl25_ref to a skill key */
  function quizRefToSkill(dl25Ref) {
    // dl25_ref looks like "2 — Controlled Stop" or "12a — Control — Accelerator"
    // Extract the numeric/alphanumeric prefix before the dash
    var prefix = dl25Ref.split(/\s/)[0].replace(/[^0-9a-z]/gi, '');
    // Try exact match first, then just the number part
    return QUIZ_DL25_MAP[prefix] || QUIZ_DL25_MAP[prefix.replace(/[a-z]+$/i, '')] || null;
  }

  /** Map a legacy skill key to the new key */
  function mapLegacySkill(oldKey) {
    return LEGACY_MAP[oldKey] || oldKey;
  }

  /** Calculate mock test result */
  function mockTestResult(faults) {
    // faults = { skill_key: { driving: n, serious: n, dangerous: n }, ... }
    var totals = { driving: 0, serious: 0, dangerous: 0 };
    var keys = Object.keys(faults);
    for (var i = 0; i < keys.length; i++) {
      var f = faults[keys[i]];
      totals.driving   += (f.driving || 0);
      totals.serious   += (f.serious || 0);
      totals.dangerous += (f.dangerous || 0);
    }
    var passed = totals.driving <= MOCK_TEST.maxDrivingFaults
              && totals.serious <= MOCK_TEST.maxSeriousFaults
              && totals.dangerous <= MOCK_TEST.maxDangerousFaults;
    return { passed: passed, totals: totals };
  }

  /**
   * Calculate combined readiness score for a skill (0–100)
   *
   * @param {Object} data - { lessonRatings: [{score, date}], quizResults: [{correct, date}], lastPractised: Date|null }
   * @returns {number} 0–100
   */
  function readinessScore(data) {
    var lessonComponent = 0;
    var quizComponent = 0;
    var recencyBonus = 0;

    // Lesson rating: average of last 3, normalised 1-3 → 0-100
    if (data.lessonRatings && data.lessonRatings.length > 0) {
      var recent = data.lessonRatings.slice(0, 3);
      var sum = 0;
      for (var i = 0; i < recent.length; i++) sum += recent[i].score;
      var avg = sum / recent.length; // 1–3
      lessonComponent = ((avg - 1) / 2) * 100; // 0–100
    }

    // Quiz accuracy: % correct
    if (data.quizResults && data.quizResults.length > 0) {
      var correct = 0;
      for (var j = 0; j < data.quizResults.length; j++) {
        if (data.quizResults[j].correct) correct++;
      }
      quizComponent = (correct / data.quizResults.length) * 100;
    }

    // Recency: full marks if practised in last 7 days, decays over 30 days
    if (data.lastPractised) {
      var daysSince = (Date.now() - new Date(data.lastPractised).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 7) {
        recencyBonus = 100;
      } else if (daysSince <= 30) {
        recencyBonus = Math.max(0, 100 - ((daysSince - 7) / 23) * 100);
      }
    }

    // Weighted average: 50% lesson, 30% quiz, 20% recency
    var hasLesson = data.lessonRatings && data.lessonRatings.length > 0;
    var hasQuiz = data.quizResults && data.quizResults.length > 0;

    if (hasLesson && hasQuiz) {
      return Math.round(lessonComponent * 0.5 + quizComponent * 0.3 + recencyBonus * 0.2);
    } else if (hasLesson) {
      return Math.round(lessonComponent * 0.7 + recencyBonus * 0.3);
    } else if (hasQuiz) {
      return Math.round(quizComponent * 0.7 + recencyBonus * 0.3);
    }
    return 0;
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    AREAS:          AREAS,
    SKILLS:         SKILLS,
    FAULT_TYPES:    FAULT_TYPES,
    RATINGS:        RATINGS,
    MOCK_TEST:      MOCK_TEST,
    LEGACY_MAP:     LEGACY_MAP,
    QUIZ_DL25_MAP:  QUIZ_DL25_MAP,

    getSkill:        getSkill,
    getSkillsByArea: getSkillsByArea,
    getAreaForSkill: getAreaForSkill,
    quizRefToSkill:  quizRefToSkill,
    mapLegacySkill:  mapLegacySkill,
    mockTestResult:  mockTestResult,
    readinessScore:  readinessScore
  };
})();
