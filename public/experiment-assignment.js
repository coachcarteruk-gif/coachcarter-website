/* First-party, pre-render experiment assignment.
 *
 * Load this synchronously in <head>, before any experiment markup is parsed:
 * <script src="/experiment-assignment.js"
 *   data-experiment-key="example-v1"
 *   data-variants="A:50,B:50"
 *   data-status="active"
 *   data-fallback="A"></script>
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var experimentKey = String(script.dataset.experimentKey || '').trim();
  var status = String(script.dataset.status || 'draft').trim().toLowerCase();
  var fallback = String(script.dataset.fallback || 'A').trim();
  var storageKey = 'cc_experiment_assignments';

  function parseVariants(raw) {
    return String(raw || '').split(',').map(function (entry) {
      var parts = entry.split(':');
      return { name: String(parts[0] || '').trim(), weight: Number(parts[1]) };
    }).filter(function (entry) {
      return entry.name && Number.isFinite(entry.weight) && entry.weight > 0;
    });
  }

  function readAssignments() {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function writeAssignments(assignments) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(assignments));
    } catch (error) {
      /* Storage can be unavailable in hardened browsers. The page still works. */
    }
  }

  function randomFraction() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      var value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] / 4294967296;
    }
    return Math.random();
  }

  function chooseVariant(variants) {
    var total = variants.reduce(function (sum, entry) { return sum + entry.weight; }, 0);
    var target = randomFraction() * total;
    for (var i = 0; i < variants.length; i += 1) {
      target -= variants[i].weight;
      if (target < 0) return variants[i].name;
    }
    return variants[variants.length - 1].name;
  }

  if (!experimentKey) return;

  var variants = parseVariants(script.dataset.variants);
  if (!variants.length) variants = [{ name: fallback, weight: 100 }];
  if (!variants.some(function (entry) { return entry.name === fallback; })) {
    fallback = variants[0].name;
  }

  var validNames = variants.map(function (entry) { return entry.name; });
  var query = new URLSearchParams(window.location.search);
  var override = String(query.get('cc_variant') || '').trim();
  var assignments = readAssignments();
  var stored = assignments[experimentKey];
  var variant = fallback;
  var source = 'fallback';
  var eligible = false;

  if (validNames.indexOf(override) !== -1) {
    variant = override;
    source = 'override';
  } else if (status === 'active') {
    eligible = true;
    if (stored && validNames.indexOf(stored.variant) !== -1) {
      variant = stored.variant;
      source = 'stored';
    } else {
      variant = chooseVariant(variants);
      source = 'random';
      assignments[experimentKey] = {
        variant: variant,
        assigned_at: new Date().toISOString()
      };
      writeAssignments(assignments);
    }
  }

  var assignment = Object.freeze({
    key: experimentKey,
    variant: variant,
    status: status,
    eligible: eligible,
    source: source
  });

  window.ccExperiments = window.ccExperiments || {};
  window.ccExperiments[experimentKey] = assignment;
  window.ccExperiment = assignment;
  document.documentElement.dataset.experimentKey = experimentKey;
  document.documentElement.dataset.experimentVariant = variant;
  document.documentElement.dataset.experimentStatus = status;
})();
