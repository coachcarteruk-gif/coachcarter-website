const { normalise, localDate } = require('./_learner-test-details');
const { operationalTimeZone, zonedDateTimeToDate } = require('./_full-curriculum');
const BUDGETS = ['saved', 'payg', 'lower', 'lowest'];
function invalid(message) { return Object.assign(new Error(message), { status: 400, code: 'INVALID_QUESTIONNAIRE' }); }
function configuration(config = {}) {
  if (config.trial_questionnaire?.enabled !== true) return null;
  const c = config.trial_questionnaire;
  if (!Array.isArray(c.supported_centres) || !c.supported_centres.length || c.supported_centres.length > 30 ||
      c.supported_centres.some(s => typeof s !== 'string' || !s.trim() || s.length > 100 || s.trim().toLowerCase() === 'other' || /[\x00-\x1f\x7f]/.test(s)) ||
      new Set(c.supported_centres.map(s => s.trim().toLowerCase())).size !== c.supported_centres.length ||
      !['maximum_hourly_pence', 'lower_budget_pence', 'lowest_budget_pence'].every(k => Number.isInteger(c[k]) && c[k] > 0 && c[k] <= 100000) ||
      !(c.maximum_hourly_pence > c.lower_budget_pence && c.lower_budget_pence > c.lowest_budget_pence)) {
    throw Object.assign(new Error('Trial questionnaire configuration needs staff review.'), { status: 503, code: 'QUESTIONNAIRE_UNAVAILABLE' });
  }
  return { enabled: true, version: 'qualification_v1', supported_centres: c.supported_centres.map(s => s.trim()),
    maximum_hourly_pence: c.maximum_hourly_pence, lower_budget_pence: c.lower_budget_pence, lowest_budget_pence: c.lowest_budget_pence };
}
function qualify(input, config, now = new Date()) {
  const c = configuration(config);
  if (!c) return null;
  if (!input || typeof input !== 'object' || typeof input.practical_booked !== 'boolean' || !BUDGETS.includes(input.budget)) {
    throw invalid('Complete the three questions before continuing.');
  }
  const timezone = operationalTimeZone(config);
  const today = localDate(now, timezone);
  const booked = input.practical_booked;
  let practical = { booked: false, date: null, time: null, centre: null }, theory = { booked: null, date: null, time: null };
  let centreChoice = null;
  if (booked) {
    centreChoice = input.centre_choice;
    if (centreChoice !== 'Other' && !c.supported_centres.includes(centreChoice)) throw invalid('Choose a test centre.');
    practical = normalise({ booked: true, date: input.practical_date, time: input.practical_time,
      centre: centreChoice === 'Other' ? input.other_centre : centreChoice }, { today });
    if (!practical.date || !practical.time || !practical.centre) throw invalid('Enter your practical test date, time and centre.');
  } else {
    if (typeof input.theory_booked !== 'boolean') throw invalid('Tell us whether you have booked your theory test.');
    theory = input.theory_booked ? normalise({ booked: true, date: input.theory_date, time: input.theory_time }, { today }) : theory;
    theory.booked = input.theory_booked;
    delete theory.centre;
    if (theory.booked && (!theory.date || !theory.time)) throw invalid('Enter your theory test date and time.');
  }
  const test = booked ? practical : theory;
  if (test.booked) {
    const instant = zonedDateTimeToDate(test.date, test.time, timezone);
    if (!instant || instant <= now) throw invalid('Enter a valid future test date and time.');
  }
  const reasons = [];
  if (!booked) reasons.push('no_practical_test');
  if (centreChoice === 'Other') reasons.push('other_centre');
  if (input.budget === 'lowest') reasons.push('lowest_budget');
  return { version: c.version, captured_local_date: today, timezone, practical, theory, centre_choice: centreChoice,
    budget: input.budget, config_snapshot: c, route: reasons.length ? 'request' : 'booking', reasons };
}
function availability(value) {
  if (!Array.isArray(value) || !value.length || value.length > 21 || value.some(s => !/^[1-7]:(morning|afternoon|evening)$/.test(s))) {
    throw invalid('Choose at least one preferred day and time period.');
  }
  return [...new Set(value)].sort();
}
module.exports = { configuration, qualify, availability, BUDGETS };
