const { neon } = require('@neondatabase/serverless');
const { createHash } = require('crypto');
const { requireAuth, getSchoolId } = require('./_auth');
const { resolveSchoolFromRequest } = require('./_tenant');
const { checkRateLimit, getClientIp } = require('./_rate-limit');
const { reportError } = require('./_error-alert');
const { funnelContext } = require('./_learner-test-details');
const { qualify, availability, configuration } = require('./_trial-qualification');
const { REFUNDED } = require('./_booking-status');
const success = { ok: true, message: 'Your request has been received. Our team will contact you to arrange a trial. No appointment has been booked.' };
const fail = (res, status, code, message) => res.status(status).json({ error: true, code, message });
function text(value, max) { return typeof value === 'string' && value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : ''; }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query.action;
  const sql = neon(process.env.POSTGRES_URL);
  try {
    if (action === 'submit') {
      if (req.method !== 'POST') return fail(res, 405, 'METHOD', 'Method not allowed');
      const tenant = await resolveSchoolFromRequest(req, { sql });
      if (!tenant) return fail(res, 404, 'SCHOOL', 'School not found');
      const schoolId = tenant.schoolId;
      const [school] = await sql`SELECT config FROM schools WHERE id=${schoolId}`;
      const b = req.body || {};
      const q = qualify(b.questionnaire, school.config);
      if (!q) return fail(res, 404, 'DISABLED', 'Trial requests are not currently available.');
      if (b.website) return res.json(success);
      const name = text(b.name, 160), email = text(b.email, 254).toLowerCase();
      const phone = text(b.phone, 30).replace(/\s/g, '').replace(/^\+44/, '0');
      const postcode = text(b.postcode_area, 8).toUpperCase().replace(/\s/g, '');
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^07\d{9}$/.test(phone) || !/^[A-Z]{1,2}\d[A-Z\d]?$/.test(postcode)) {
        return fail(res, 400, 'CONTACT', 'Enter your name, valid email, UK mobile number and postcode area (for example RG1).');
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.submission_key || '')) return fail(res, 400, 'RETRY_KEY', 'Reload the form and try again.');
      const times = availability(b.availability);
      const reason = q.route === 'request' ? 'qualification' : 'no_suitable_slots';
      const key = createHash('sha256').update(schoolId + ':' + email).digest('hex');
      const limit = await checkRateLimit(sql, { key: `trial_request:${schoolId}:${getClientIp(req)}`, max: 10, windowSeconds: 3600 });
      if (!limit.allowed) return fail(res, 429, 'RATE_LIMIT', 'Too many requests. Please try again later.');
      // A retry, including from another tab, has the same generic result. No account lookup.
      try {
        await sql`WITH enquiry AS (
          INSERT INTO enquiries(name,email,phone,enquiry_type,message,marketing_consent,school_id)
          SELECT ${name},${email},${phone},'trial-request','Trial request: review structured answers in Learner Controls.',false,${schoolId}
          WHERE NOT EXISTS(SELECT 1 FROM trial_requests WHERE school_id=${schoolId} AND (contact_key=${key} OR submission_key=${b.submission_key}::uuid))
          RETURNING id
        ) INSERT INTO trial_requests(school_id,enquiry_id,submission_key,contact_key,postcode_area,availability,questionnaire,funnel_context,reason)
          SELECT ${schoolId},id,${b.submission_key}::uuid,${key},${postcode},${JSON.stringify(times)}::jsonb,
            ${JSON.stringify(q)}::jsonb,${JSON.stringify(funnelContext(b.funnel_context))}::jsonb,${reason} FROM enquiry`;
      } catch (e) { if (e.code !== '23505') throw e; /* racing duplicate rolls back the entire statement */ }
      return res.json(success);
    }
    const admin = requireAuth(req, { roles: ['admin'] });
    if (!admin) return fail(res, 401, 'AUTH', 'Admin access required');
    const schoolId = getSchoolId(admin, req);
    if (action === 'settings' && req.method === 'GET') {
      const [school] = await sql`SELECT config->'trial_questionnaire' AS configuration FROM schools WHERE id=${schoolId}`;
      return res.json({ ok: true, configuration: school?.configuration || {} });
    }
    if (action === 'list' || action === 'export') {
      if (req.method !== 'GET') return fail(res, 405, 'METHOD', 'Method not allowed');
      const id = action === 'export' ? Number(req.query.id) : null;
      if (action === 'export' && !Number.isSafeInteger(id)) return fail(res, 400, 'ID', 'Choose a request.');
      const before = Number(req.query.before) || 9223372036854775807;
      const rows = await sql`SELECT r.id,r.submitted_at,r.postcode_area,r.availability,r.questionnaire,r.funnel_context,r.reason,
        e.name,e.email,e.phone,e.status,l.booking_id FROM trial_requests r
        JOIN enquiries e ON e.school_id=${schoolId} AND e.id=r.enquiry_id
        LEFT JOIN trial_request_bookings l ON l.school_id=${schoolId} AND l.request_id=r.id
        WHERE r.school_id=${schoolId} AND (${id}::bigint IS NULL OR r.id=${id}) AND r.id<${before}::numeric ORDER BY r.id DESC LIMIT 51`;
      return res.json({ ok: true, requests: rows.slice(0,50), next: rows.length > 50 ? rows[49].id : null });
    }
    if (req.method !== 'POST') return fail(res, 405, 'METHOD', 'Method not allowed');
    if (action === 'configure') {
      const value = req.body?.configuration;
      // Validate an enabled copy even when staff are saving disabled settings.
      const checked = configuration({ trial_questionnaire: { ...value, enabled: true } });
      checked.enabled = value?.enabled === true;
      await sql.transaction([
        sql`UPDATE schools SET config=jsonb_set(COALESCE(config,'{}'),'{trial_questionnaire}',${JSON.stringify(checked)}::jsonb),updated_at=now() WHERE id=${schoolId}`,
        sql`INSERT INTO audit_log(admin_id,action,target_type,target_id,details,school_id) VALUES(${admin.id},'trial_questionnaire.configure','school',${schoolId},${JSON.stringify(checked)}::jsonb,${schoolId})`
      ]);
      return res.json({ ok: true });
    }
    const requestId = Number(req.body?.request_id);
    if (!Number.isSafeInteger(requestId) || requestId < 1) return fail(res, 400, 'ID', 'Choose a request.');
    const [r] = await sql`SELECT r.*,e.email FROM trial_requests r JOIN enquiries e ON e.id=r.enquiry_id AND e.school_id=${schoolId} WHERE r.id=${requestId} AND r.school_id=${schoolId}`;
    if (!r) return fail(res, 404, 'NOT_FOUND', 'Request not found');
    if (action === 'delete') {
      await sql.transaction([
        sql`DELETE FROM trial_booking_intakes t USING trial_request_bookings l
          WHERE t.school_id=${schoolId} AND l.school_id=${schoolId} AND l.request_id=${requestId} AND t.booking_id=l.booking_id`,
        sql`DELETE FROM enquiries WHERE id=${r.enquiry_id} AND school_id=${schoolId}`,
        sql`INSERT INTO audit_log(admin_id,action,target_type,target_id,details,school_id) VALUES(${admin.id},'trial_request.delete','trial_request',${requestId},'{}',${schoolId})`
      ]);
      return res.json({ ok: true });
    }
    if (action === 'link-booking') {
      const bookingId = Number(req.body.booking_id);
      if (!Number.isSafeInteger(bookingId) || bookingId < 1) return fail(res, 400, 'BOOKING', 'Enter the original booking ID.');
      const [existing] = await sql`SELECT booking_id FROM trial_request_bookings WHERE school_id=${schoolId} AND request_id=${requestId}`;
      if (existing) return existing.booking_id === bookingId ? res.json({ ok:true }) : fail(res,409,'ALREADY_LINKED','This request already has a booking.');
      const [b] = await sql`SELECT b.* FROM lesson_bookings b JOIN learner_users lu ON lu.id=b.learner_id AND lu.school_id=${schoolId}
        JOIN lesson_types lt ON lt.id=b.lesson_type_id AND lt.school_id=${schoolId}
        WHERE b.id=${bookingId} AND b.school_id=${schoolId} AND lower(lu.email)=${r.email.toLowerCase()}
          AND lt.slug='trial' AND b.rescheduled_from IS NULL AND b.created_at>=${r.submitted_at}::timestamptz
          AND (b.status<>${REFUNDED} OR EXISTS(SELECT 1 FROM lesson_bookings child WHERE child.school_id=${schoolId} AND child.rescheduled_from=b.id AND child.learner_id=b.learner_id))`;
      if (!b) return fail(res,400,'BOOKING','Choose a same-school trial booked after this request, for the same email. Use its original booking ID.');
      const q = r.questionnaire, p = q.practical, f = r.funnel_context;
      await sql.transaction([
        sql`INSERT INTO trial_booking_intakes(school_id,booking_id,learner_id,instructor_id,booked_at,booking_local_date,school_timezone,
          test_booked,test_date_snapshot,test_time_snapshot,test_centre_snapshot,segment,segment_version,entry_page,campaign_key,content_version,analytics_consent_at_booking,questionnaire)
          VALUES(${schoolId},${bookingId},${b.learner_id},${b.instructor_id},${b.created_at},(${b.created_at}::timestamptz AT TIME ZONE ${q.timezone})::date,${q.timezone},
            ${p.booked},${p.date},${p.time},${p.centre},'unknown','test_date_v1',${f.entry_page},${f.campaign_key},${f.content_version},${f.analytics_consent_at_booking},${JSON.stringify(q)}::jsonb)`,
        sql`INSERT INTO trial_request_bookings(school_id,request_id,booking_id) VALUES(${schoolId},${requestId},${bookingId})`,
        sql`INSERT INTO audit_log(admin_id,action,target_type,target_id,details,school_id) VALUES(${admin.id},'trial_request.link','trial_request',${requestId},${JSON.stringify({booking_id:bookingId})}::jsonb,${schoolId})`
      ]);
      return res.json({ ok: true });
    }
    return fail(res,400,'ACTION','Unknown action');
  } catch (e) {
    if (e.status) return fail(res,e.status,e.code || 'INVALID',e.message);
    if (e.code === '23505') return fail(res,409,'CONFLICT','This booking or request already has intake evidence. Refresh the request list.');
    reportError('/api/trial-requests', new Error('Trial request operation failed: '+(e.code || 'unknown')));
    return fail(res,500,'SERVER','Unable to complete this action. Please try again.');
  }
};
