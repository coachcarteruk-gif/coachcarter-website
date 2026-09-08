// Course-specific requests, never blanket marketing consent.
function parseTrialPreferences(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('A booking request is required.');
  }
  for (const key of ['email_course_opt_in', 'intensive_interest']) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      throw new Error('Course preferences must be true or false.');
    }
  }
  const supplied = body.intensive_months === undefined ? [] : body.intensive_months;
  if (!Array.isArray(supplied) || supplied.length > 12) {
    throw new Error('Choose up to 12 preferred months.');
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year').value);
  const month = Number(parts.find(p => p.type === 'month').value) - 1;
  const allowed = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(year, month + i, 1)).toISOString().slice(0, 7));
  if (supplied.some(value => typeof value !== 'string' || !allowed.includes(value))) {
    throw new Error('Choose months within the next 12 months. Refresh the page to update the choices.');
  }
  const emailCourse = body.email_course_opt_in === true;
  const intensive = body.intensive_interest === true;
  const months = intensive ? [...new Set(supplied)].sort() : [];
  return {
    requested: emailCourse || intensive,
    message: [
      'Free trial course preferences (v1). Contact by email about selected courses only.',
      '30 Days to Pass Your Test email course: ' + (emailCourse ? 'Yes' : 'No'),
      'Intensive course information: ' + (intensive ? 'Yes' : 'No'),
      'Preferred intensive start months: ' + (intensive ? (months.join(', ') || 'Not sure yet') : 'Not requested')
    ].join('\n')
  };
}

module.exports = { parseTrialPreferences };
