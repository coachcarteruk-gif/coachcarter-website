/**
 * CoachCarter Competency Framework
 * ─────────────────────────────────
 * Single source of truth for the DL25-aligned driving skills.
 * 10 categories matching the real DVSA DL25 marking sheet,
 * used across Log Session, Examiner Quiz, Mock Test, My Progress,
 * and Ask the Examiner AI.
 *
 * Every feature imports this file via <script src="/competency-config.js">
 * so wording, grouping, and skill keys are always consistent.
 */
window.CC_COMPETENCY = (function () {
  'use strict';

  // ── 10 DL25 Categories ─────────────────────────────────────────
  var AREAS = [
    { id: 'control',        label: 'Control',                     icon: '🚗', colour: '#6366f1' },
    { id: 'move_off',       label: 'Move Off',                    icon: '🟢', colour: '#22c55e' },
    { id: 'mirrors',        label: 'Use of Mirrors',              icon: '👁️', colour: '#0ea5e9' },
    { id: 'signals',        label: 'Signals',                     icon: '🔶', colour: '#f59e0b' },
    { id: 'junctions',      label: 'Junctions',                   icon: '🔀', colour: '#ef4444' },
    { id: 'judgement',      label: 'Judgement',                   icon: '⚡', colour: '#8b5cf6' },
    { id: 'positioning',    label: 'Positioning',                 icon: '🛣️', colour: '#0d9488' },
    { id: 'progress',       label: 'Progress',                   icon: '📈', colour: '#f97316' },
    { id: 'signs_signals',  label: 'Response to Signs / Signals', icon: '🚦', colour: '#e11d48' },
    { id: 'manoeuvres',     label: 'Manoeuvres',                  icon: '🅿️', colour: '#10b981' }
  ];

  // ── Skills (DL25-aligned) ──────────────────────────────────────
  //
  //  key          – area-level key, stored in DB (skill_ratings.skill_key for session logs)
  //  label        – plain-English name shown to learner
  //  area         – parent category id (same as key for these)
  //  subs         – DL25 sub-skills for detailed fault recording in mock tests
  //  description  – one-liner for tooltips / AI context
  //
  var SKILLS = [
    // ── 1. Control ───────────────────────────────────────────────
    { key: 'control', label: 'Control', area: 'control',
      subs: [
        { key: 'accelerator',   label: 'Accelerator' },
        { key: 'clutch',        label: 'Clutch' },
        { key: 'gears',         label: 'Gears' },
        { key: 'footbrake',     label: 'Footbrake' },
        { key: 'parking_brake', label: 'Parking brake' },
        { key: 'steering',      label: 'Steering' }
      ],
      description: 'Smooth, accurate use of accelerator, clutch, gears, brakes, and steering' },

    // ── 2. Move Off ──────────────────────────────────────────────
    { key: 'move_off', label: 'Move Off', area: 'move_off',
      subs: [
        { key: 'safety',  label: 'Safety' },
        { key: 'control', label: 'Control' }
      ],
      description: 'Moving off safely — flat, uphill, downhill, and at an angle' },

    // ── 3. Use of Mirrors ────────────────────────────────────────
    { key: 'mirrors', label: 'Use of Mirrors', area: 'mirrors',
      subs: [
        { key: 'signalling',       label: 'Signalling' },
        { key: 'change_direction', label: 'Change direction' },
        { key: 'change_speed',     label: 'Change speed' }
      ],
      description: 'Checking mirrors before signalling, changing direction, or speed' },

    // ── 4. Signals ───────────────────────────────────────────────
    { key: 'signals', label: 'Signals', area: 'signals',
      subs: [
        { key: 'necessary', label: 'Necessary' },
        { key: 'correctly', label: 'Correctly' },
        { key: 'timed',     label: 'Timed' }
      ],
      description: 'Timely, correct signals — not too early, late, or misleading' },

    // ── 5. Junctions ─────────────────────────────────────────────
    { key: 'junctions', label: 'Junctions', area: 'junctions',
      subs: [
        { key: 'approach_speed',  label: 'Approach speed' },
        { key: 'observation',     label: 'Observation' },
        { key: 'turning_right',   label: 'Turning right' },
        { key: 'turning_left',    label: 'Turning left' },
        { key: 'cutting_corners', label: 'Cutting corners' }
      ],
      description: 'Correct approach, observation, and timing at junctions and roundabouts' },

    // ── 6. Judgement ─────────────────────────────────────────────
    { key: 'judgement', label: 'Judgement', area: 'judgement',
      subs: [
        { key: 'overtaking', label: 'Overtaking' },
        { key: 'meeting',    label: 'Meeting' },
        { key: 'crossing',   label: 'Crossing' }
      ],
      description: 'Assessing gaps, speeds, and distances — overtaking, meeting traffic, crossroads' },

    // ── 7. Positioning ───────────────────────────────────────────
    { key: 'positioning', label: 'Positioning', area: 'positioning',
      subs: [
        { key: 'normal_driving',      label: 'Normal driving' },
        { key: 'lane_discipline',     label: 'Lane discipline' },
        { key: 'pedestrian_crossings', label: 'Pedestrian crossings' },
        { key: 'position_normal_stop', label: 'Position / normal stop' },
        { key: 'awareness_planning',  label: 'Awareness planning' },
        { key: 'clearance',           label: 'Clearance' },
        { key: 'following_distance',  label: 'Following distance' },
        { key: 'use_of_speed',        label: 'Use of speed' }
      ],
      description: 'Correct lane positioning, clearance, following distance, and speed for conditions' },

    // ── 8. Progress ──────────────────────────────────────────────
    { key: 'progress', label: 'Progress', area: 'progress',
      subs: [
        { key: 'appropriate_speed', label: 'Appropriate speed' },
        { key: 'undue_hesitation',  label: 'Undue hesitation' }
      ],
      description: 'Making reasonable progress without unnecessary hesitation or delay' },

    // ── 9. Response to Signs / Signals ───────────────────────────
    { key: 'signs_signals', label: 'Response to Signs / Signals', area: 'signs_signals',
      subs: [
        { key: 'traffic_signs',       label: 'Traffic signs' },
        { key: 'road_markings',       label: 'Road markings' },
        { key: 'traffic_lights',      label: 'Traffic lights' },
        { key: 'traffic_controllers', label: 'Traffic controllers' },
        { key: 'other_road_users',    label: 'Other road users' }
      ],
      description: 'Correct response to traffic lights, road signs, markings, and signals' },

    // ── 10. Manoeuvres ───────────────────────────────────────────
    { key: 'manoeuvres', label: 'Manoeuvres', area: 'manoeuvres',
      subs: [
        { key: 'control',     label: 'Control' },
        { key: 'observation', label: 'Observation' }
      ],
      description: 'Vehicle control and observation during reverse park, forward park, or pull-up manoeuvres' }
  ];

  // ── Manoeuvre Types (selectable in mock tests) ─────────────────
  var MANOEUVRE_TYPES = [
    { key: 'reverse_right',       label: 'Reverse / Right' },
    { key: 'reverse_park_road',   label: 'Reverse park (road)' },
    { key: 'reverse_park_car',    label: 'Reverse park (car park)' },
    { key: 'forward_park',        label: 'Forward park' }
  ];

  // ── Supervisor Categories (simplified for parents / supervising drivers) ──
  //
  // 7 plain-English groupings that map back to DL25 skills.
  // Used in supervisor mock test mode and focused practice setup.
  //
  var SUPERVISOR_CATEGORIES = [
    { key: 'observation',  label: 'Observation & Awareness',
      icon: '👁️', colour: '#0ea5e9',
      description: 'Checking mirrors and being aware of what\u2019s around the car',
      dl25Skills: ['mirrors', 'judgement'],
      faultHints: [
        'Not checking mirrors before changing speed or direction',
        'Missing other road users when pulling out or changing lanes',
        'Reacting late to hazards like pedestrians or cyclists'
      ],
      reflectionQ: 'How were their mirror checks and awareness of other road users?' },

    { key: 'speed_control', label: 'Speed & Control',
      icon: '🚗', colour: '#6366f1',
      description: 'Smooth use of pedals, gears, steering, and appropriate speed',
      dl25Skills: ['control', 'progress'],
      faultHints: [
        'Harsh braking, stalling, or rough gear changes',
        'Driving too fast or too slow for the road conditions',
        'Hesitating unnecessarily or not making progress when safe'
      ],
      reflectionQ: 'How smooth was their control of the car and choice of speed?' },

    { key: 'junctions',    label: 'Junctions & Roundabouts',
      icon: '🔀', colour: '#ef4444',
      description: 'Approaching, observing, and turning at junctions and roundabouts',
      dl25Skills: ['junctions'],
      faultHints: [
        'Approaching junctions too fast or not looking properly',
        'Pulling out when it\u2019s not safe to do so',
        'Wrong lane or position at roundabouts'
      ],
      reflectionQ: 'How did they handle junctions and roundabouts?' },

    { key: 'positioning',  label: 'Road Positioning',
      icon: '🛣️', colour: '#0d9488',
      description: 'Staying in the correct lane and keeping a safe distance',
      dl25Skills: ['positioning'],
      faultHints: [
        'Drifting into the wrong lane or straddling lanes',
        'Following the car in front too closely',
        'Not leaving enough room when passing parked cars'
      ],
      reflectionQ: 'How was their lane position and following distance?' },

    { key: 'signals',      label: 'Signals & Communication',
      icon: '🔶', colour: '#f59e0b',
      description: 'Using indicators correctly and responding to signs and traffic lights',
      dl25Skills: ['signals', 'signs_signals'],
      faultHints: [
        'Forgetting to indicate or indicating too late',
        'Missing road signs, traffic lights, or road markings',
        'Confusing other road users with wrong or no signals'
      ],
      reflectionQ: 'How well did they use signals and respond to road signs?' },

    { key: 'manoeuvres',   label: 'Manoeuvres',
      icon: '🅿️', colour: '#10b981',
      description: 'Parking, reversing, and turning the car around safely',
      dl25Skills: ['manoeuvres'],
      faultHints: [
        'Poor control or accuracy during parking or reversing',
        'Not checking all around the car before and during the manoeuvre',
        'Mounting the kerb or ending up far from it'
      ],
      reflectionQ: 'How did their manoeuvres (parking, reversing) go?' },

    { key: 'moving_off',   label: 'Moving Off',
      icon: '🟢', colour: '#22c55e',
      description: 'Starting the car and pulling away safely on flat, hills, and at angles',
      dl25Skills: ['move_off'],
      faultHints: [
        'Not checking mirrors and blind spots before moving off',
        'Stalling or rolling back on a hill',
        'Pulling out into traffic without enough gap'
      ],
      reflectionQ: 'How confident were they when moving off and pulling away?' }
  ];

  // ── Supervisor Ratings (simplified for parents) ────────────────
  var SUPERVISOR_RATINGS = [
    { key: 'good',       label: 'Went well',   colour: '#22c55e', score: 3 },
    { key: 'needs_work', label: 'Needs work',   colour: '#f59e0b', score: 2 },
    { key: 'concern',    label: 'Concern',       colour: '#ef4444', score: 1 }
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
      { description: 'Drive as you would on your test. Your assessor will note any faults.', durationMinutes: 10 }
    ]
  };

  // ── Legacy Skill Mapping ───────────────────────────────────────
  // Maps ALL old skill keys to new equivalents so existing data renders.
  var LEGACY_MAP = {
    // Old v1 keys (pre-DL25)
    speed_choice:     'positioning',
    lane_choice:      'positioning',
    lane_keeping:     'positioning',
    stay_or_go:       'junctions',
    roundabouts:      'junctions',

    // Old v2 keys (28-skill structure)
    accelerator_12a:  'control',
    clutch_12b:       'control',
    gears_12c:        'control',
    footbrake_12d:    'control',
    parking_brake_12e:'control',
    steering_12f:     'control',
    ancillary_27:     'control',
    move_off_13:      'move_off',
    mirrors_14:       'mirrors',
    signals_15:       'signals',
    junctions_21:     'junctions',
    judgement_22:     'judgement',
    positioning_23:   'positioning',
    clearance_16:     'positioning',
    following_19:     'positioning',
    normal_stop_25:   'positioning',
    speed_18:         'positioning',
    pedestrians_24:   'positioning',
    awareness_26:     'positioning',
    progress_20:      'progress',
    signs_signals_17: 'signs_signals',
    reverse_right_4:  'manoeuvres',
    reverse_park_5:   'manoeuvres',
    forward_park_8:   'manoeuvres',
    controlled_stop_2:'manoeuvres',
    precautions_11:   'positioning',

    // Removed skills → nearest category
    eyesight_1:       null,
    show_tell_7:      null
  };

  // ── Scenario-to-Skill Mapping ──────────────────────────────────
  // Maps examiner quiz dl25_ref prefixes to skill keys.
  var QUIZ_DL25_MAP = {
    '12a': 'control',
    '12b': 'control',
    '12c': 'control',
    '12d': 'control',
    '12e': 'control',
    '12f': 'control',
    '13':  'move_off',
    '14':  'mirrors',
    '15':  'signals',
    '16':  'positioning',
    '17':  'signs_signals',
    '18':  'positioning',
    '19':  'positioning',
    '20':  'progress',
    '21':  'junctions',
    '22':  'judgement',
    '23':  'positioning',
    '24':  'positioning',
    '25':  'positioning',
    '26':  'positioning',
    '4':   'manoeuvres',
    '5':   'manoeuvres',
    '8':   'manoeuvres',
    '2':   'manoeuvres'
  };

  // ── Helper Functions ───────────────────────────────────────────

  /** Get a skill by its key */
  function getSkill(key) {
    for (var i = 0; i < SKILLS.length; i++) {
      if (SKILLS[i].key === key) return SKILLS[i];
    }
    return null;
  }

  /** Get all skills in a category (usually just 1 since key === area) */
  function getSkillsByArea(areaId) {
    var result = [];
    for (var i = 0; i < SKILLS.length; i++) {
      if (SKILLS[i].area === areaId) result.push(SKILLS[i]);
    }
    return result;
  }

  /** Get the category object for a skill key */
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
    var prefix = dl25Ref.split(/\s/)[0].replace(/[^0-9a-z]/gi, '');
    return QUIZ_DL25_MAP[prefix] || QUIZ_DL25_MAP[prefix.replace(/[a-z]+$/i, '')] || null;
  }

  /** Map a legacy skill key to the new key */
  function mapLegacySkill(oldKey) {
    if (LEGACY_MAP.hasOwnProperty(oldKey)) return LEGACY_MAP[oldKey];
    return oldKey;
  }

  /** Check if a skill has DL25 subcategories */
  function hasSubs(skillKey) {
    var skill = getSkill(skillKey);
    return skill && skill.subs && skill.subs.length > 0;
  }

  /** Calculate mock test result */
  function mockTestResult(faults) {
    var totals = { driving: 0, serious: 0, dangerous: 0 };
    var keys = Object.keys(faults);
    for (var i = 0; i < keys.length; i++) {
      var f = faults[keys[i]];
      totals.driving   += (f.driving || 0);
      totals.serious   += (f.serious || 0);
      totals.dangerous += (f.dangerous || 0);
      if (f.subs) {
        var subKeys = Object.keys(f.subs);
        for (var j = 0; j < subKeys.length; j++) {
          var sf = f.subs[subKeys[j]];
          totals.driving   += (sf.driving || 0);
          totals.serious   += (sf.serious || 0);
          totals.dangerous += (sf.dangerous || 0);
        }
      }
    }
    var passed = totals.driving <= MOCK_TEST.maxDrivingFaults
              && totals.serious <= MOCK_TEST.maxSeriousFaults
              && totals.dangerous <= MOCK_TEST.maxDangerousFaults;
    return { passed: passed, totals: totals };
  }

  /**
   * Calculate combined readiness score for a skill (0–100)
   *
   * @param {Object} data - { lessonRatings: [{score, date}], quizResults: [{correct, date}], mockFaults: [{driving, serious, dangerous}], lastPractised: Date|null }
   * @returns {number} 0–100
   */
  function readinessScore(data) {
    var lessonComponent = 0;
    var quizComponent = 0;
    var mockComponent = 0;
    var recencyBonus = 0;

    // Lesson rating: average of last 3, normalised 1-3 → 0-100
    if (data.lessonRatings && data.lessonRatings.length > 0) {
      var recent = data.lessonRatings.slice(0, 3);
      var sum = 0;
      for (var i = 0; i < recent.length; i++) sum += recent[i].score;
      var avg = sum / recent.length;
      lessonComponent = ((avg - 1) / 2) * 100;
    }

    // Quiz accuracy: % correct
    if (data.quizResults && data.quizResults.length > 0) {
      var correct = 0;
      for (var j = 0; j < data.quizResults.length; j++) {
        if (data.quizResults[j].correct) correct++;
      }
      quizComponent = (correct / data.quizResults.length) * 100;
    }

    // Mock test fault score: fewer faults = higher score
    // Based on most recent mock test faults for this skill
    if (data.mockFaults && data.mockFaults.length > 0) {
      var latestMock = data.mockFaults[0];
      var totalFaults = (latestMock.driving || 0) + (latestMock.serious || 0) * 5 + (latestMock.dangerous || 0) * 10;
      mockComponent = Math.max(0, 100 - totalFaults * 20);
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

    // Weighted average based on available data
    var hasLesson = data.lessonRatings && data.lessonRatings.length > 0;
    var hasQuiz = data.quizResults && data.quizResults.length > 0;
    var hasMock = data.mockFaults && data.mockFaults.length > 0;

    if (hasLesson && hasQuiz && hasMock) {
      return Math.round(lessonComponent * 0.35 + quizComponent * 0.2 + mockComponent * 0.25 + recencyBonus * 0.2);
    } else if (hasLesson && hasMock) {
      return Math.round(lessonComponent * 0.4 + mockComponent * 0.35 + recencyBonus * 0.25);
    } else if (hasLesson && hasQuiz) {
      return Math.round(lessonComponent * 0.5 + quizComponent * 0.3 + recencyBonus * 0.2);
    } else if (hasLesson) {
      return Math.round(lessonComponent * 0.7 + recencyBonus * 0.3);
    } else if (hasMock) {
      return Math.round(mockComponent * 0.7 + recencyBonus * 0.3);
    } else if (hasQuiz) {
      return Math.round(quizComponent * 0.7 + recencyBonus * 0.3);
    }
    return 0;
  }

  // ── Supervisor Helpers ──────────────────────────────────────────

  /** Get a supervisor category by key */
  function getSupervisorCategory(key) {
    for (var i = 0; i < SUPERVISOR_CATEGORIES.length; i++) {
      if (SUPERVISOR_CATEGORIES[i].key === key) return SUPERVISOR_CATEGORIES[i];
    }
    return null;
  }

  /**
   * Map a supervisor category rating to DL25 skill_ratings entries for storage.
   * Returns an array of { skill_key, rating } objects using the lesson rating scale.
   */
  function supervisorToDL25(categoryKey, supervisorRating) {
    var cat = getSupervisorCategory(categoryKey);
    if (!cat) return [];
    // Map supervisor ratings to lesson rating keys
    var ratingMap = { good: 'nailed', needs_work: 'ok', concern: 'struggled' };
    var mapped = ratingMap[supervisorRating] || 'ok';
    var result = [];
    for (var i = 0; i < cat.dl25Skills.length; i++) {
      result.push({ skill_key: cat.dl25Skills[i], rating: mapped });
    }
    return result;
  }

  /**
   * Get the N weakest areas using supervisor-friendly categories.
   * Aggregates readiness scores from underlying DL25 skills.
   *
   * @param {Object} skillScores - map of skill_key -> readiness score (0-100)
   * @param {number} count - how many weak areas to return (default 3)
   * @returns {Array} sorted array of { category, score } (lowest first)
   */
  function getWeakAreas(skillScores, count) {
    count = count || 3;
    var scored = [];
    for (var i = 0; i < SUPERVISOR_CATEGORIES.length; i++) {
      var cat = SUPERVISOR_CATEGORIES[i];
      var total = 0;
      var n = 0;
      for (var j = 0; j < cat.dl25Skills.length; j++) {
        var s = skillScores[cat.dl25Skills[j]];
        if (typeof s === 'number') { total += s; n++; }
      }
      var avg = n > 0 ? Math.round(total / n) : 0;
      scored.push({ category: cat, score: avg });
    }
    scored.sort(function(a, b) { return a.score - b.score; });
    return scored.slice(0, count);
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    AREAS:            AREAS,
    SKILLS:           SKILLS,
    FAULT_TYPES:      FAULT_TYPES,
    RATINGS:          RATINGS,
    MOCK_TEST:        MOCK_TEST,
    MANOEUVRE_TYPES:        MANOEUVRE_TYPES,
    SUPERVISOR_CATEGORIES: SUPERVISOR_CATEGORIES,
    SUPERVISOR_RATINGS:    SUPERVISOR_RATINGS,
    LEGACY_MAP:            LEGACY_MAP,
    QUIZ_DL25_MAP:         QUIZ_DL25_MAP,

    getSkill:               getSkill,
    getSkillsByArea:        getSkillsByArea,
    getAreaForSkill:        getAreaForSkill,
    quizRefToSkill:         quizRefToSkill,
    mapLegacySkill:         mapLegacySkill,
    hasSubs:                hasSubs,
    mockTestResult:         mockTestResult,
    readinessScore:         readinessScore,
    getSupervisorCategory:  getSupervisorCategory,
    supervisorToDL25:       supervisorToDL25,
    getWeakAreas:           getWeakAreas
  };
})();
