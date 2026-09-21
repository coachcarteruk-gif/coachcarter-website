// One contract for self-reported current details; never writes test-day arrangements.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
function invalid(message) { return Object.assign(new Error(message), { status: 400, code: 'INVALID_TEST_DETAILS' }); }
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}
function localDate(now, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function normalise(input = {}, { today = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Check your practical test details.');
  const booked = input.booked === undefined ? null : input.booked;
  if (booked !== null && typeof booked !== 'boolean') throw invalid('Choose Yes, No or Prefer not to say.');
  const date = input.date === '' || input.date == null ? null : dateOnly(input.date);
  if (input.date != null && input.date !== '' && !date) throw invalid('Enter a real test date, or leave it blank to add later.');
  if (date && today && date < today) throw invalid('Your test date is in the past. Correct it or leave it blank to add later.');
  if (input.centre != null && typeof input.centre !== 'string') throw invalid('Enter a test centre as text.');
  const centre = (input.centre || '').trim().replace(/\s+/g, ' ') || null;
  if (centre && (centre.length > 160 || /[\x00-\x1f\x7f]/.test(centre))) throw invalid('Test centre must be at most 160 characters.');
  const time = input.time || null;
  if (time && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw invalid('Test time must be HH:MM.');
  if (booked !== true && (date || centre || time)) throw invalid('Test date, time and centre require Yes.');
  if (time && !date) throw invalid('Add a date before a test time.');
  return { booked, date, time, centre };
}
function currentDetails(row = {}) {
  const date = dateOnly(row.test_date);
  return { booked: row.test_booked == null ? (date ? true : null) : row.test_booked,
    date, time: row.test_time || null, centre: row.test_centre || null,
    updated_at: row.test_details_updated_at || null,
    source: row.test_details_updated_at ? 'current_self_reported' : 'legacy_profile',
    needs_review: Boolean(row.test_date && !date) };
}
function profilePatch(body, existing) {
  const modern = own(body, 'test_details');
  const touched = modern || ['test_booked', 'test_date', 'test_time', 'test_centre'].some(k => own(body, k));
  if (!touched) return { touched: false, booked: existing.test_booked ?? null,
    date: existing.test_date || null, time: existing.test_time || null, centre: existing.test_centre || null };
  if (modern && !own(body, 'test_details_updated_at')) throw invalid('Reload your test details before saving.');
  if (own(body, 'test_details_updated_at') && body.test_details_updated_at !== null &&
      (typeof body.test_details_updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]/.test(body.test_details_updated_at) || !Number.isFinite(Date.parse(body.test_details_updated_at)))) {
    throw invalid('Reload your test details before saving.');
  }
  const previous = currentDetails(existing);
  const patch = modern ? body.test_details : Object.fromEntries(
    ['booked', 'date', 'time', 'centre'].filter(k => own(body, 'test_' + k)).map(k => [k, body['test_' + k]]));
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Check your practical test details.');
  const next = { ...previous, ...patch };
  if (!own(patch, 'booked') && own(patch, 'date')) next.booked = patch.date ? true : null;
  if (next.booked !== true) next.date = next.time = next.centre = null;
  if (next.date !== previous.date && !own(patch, 'time')) next.time = null;
  return { ...normalise(next), touched: true };
}
function funnelContext(value) {
  const v = value && typeof value === 'object' ? value : {};
  const campaign = v.campaign_key === 'test_booked_v1';
  return { entry_page: campaign ? 'test_booked' : ['freetrial', 'free_direct'].includes(v.entry_page) ? v.entry_page : 'unknown',
    campaign_key: campaign ? 'test_booked_v1' : null,
    content_version: ['text_v1', 'video_v1'].includes(v.content_version) ? v.content_version : null,
    analytics_consent_at_booking: v.analytics_consent_at_booking === true };
}
module.exports = { dateOnly, localDate, normalise, currentDetails, profilePatch, funnelContext };
