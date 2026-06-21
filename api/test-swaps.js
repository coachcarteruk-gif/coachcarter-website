// Test Swaps Marketplace
// Learner marketplace + admin accepted-swap queue. Learner responses never
// expose other learners' identity/contact details; admin queue does.

const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { createTransporter } = require('./_auth-helpers');
const { sendWhatsApp } = require('./_whatsapp');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');

const LISTING_ACTIVE = 'active';
const LISTING_ACCEPTED = 'accepted_in_principle';
const LISTING_COMPLETED = 'completed';
const LISTING_CANCELLED = 'cancelled';

const REQUEST_PENDING = 'pending';
const REQUEST_ACCEPTED = 'accepted';
const REQUEST_DECLINED = 'declined';
const REQUEST_WITHDRAWN = 'withdrawn';
const REQUEST_COMPLETED = 'completed';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

module.exports = async function handler(req, res) {
  const action = req.query.action;

  if (action === 'summary') return handleLearnerSummary(req, res);
  if (action === 'notification-count') return handleNotificationCount(req, res);
  if (action === 'create-listing') return handleCreateListing(req, res);
  if (action === 'delete-listing') return handleDeleteListing(req, res);
  if (action === 'request-listing') return handleRequestListing(req, res);
  if (action === 'accept-request') return handleAcceptRequest(req, res);
  if (action === 'decline-request') return handleDeclineRequest(req, res);
  if (action === 'withdraw-request') return handleWithdrawRequest(req, res);
  if (action === 'admin-accepted') return handleAdminAccepted(req, res);
  if (action === 'admin-complete') return handleAdminComplete(req, res);

  return res.status(400).json({ error: true, code: 'UNKNOWN_ACTION', message: 'Unknown action' });
};

function getSql() {
  return neon(process.env.POSTGRES_URL);
}

function normalizeCentre(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function hasOfficialTest(profile) {
  return !!(profile && profile.test_date && profile.test_time && normalizeCentre(profile.test_centre));
}

function assertDate(value, fieldName) {
  const v = String(value || '').trim();
  if (!DATE_RE.test(v)) {
    const err = new Error(`${fieldName} must be YYYY-MM-DD`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}

function assertTime(value, fieldName) {
  const v = String(value || '').trim();
  if (!TIME_RE.test(v)) {
    const err = new Error(`${fieldName} must be HH:MM`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}

function normalizeWindows(windows) {
  if (!Array.isArray(windows) || windows.length < 1) {
    const err = new Error('At least one acceptable replacement window is required');
    err.statusCode = 400;
    throw err;
  }
  if (windows.length > 8) {
    const err = new Error('Maximum 8 acceptable replacement windows');
    err.statusCode = 400;
    throw err;
  }

  return windows.map((w) => {
    const start = assertDate(w.start_date, 'Window start date');
    const end = assertDate(w.end_date, 'Window end date');
    if (start > end) {
      const err = new Error('Window end date must be on or after start date');
      err.statusCode = 400;
      throw err;
    }
    return { start_date: start, end_date: end };
  });
}

function normalizeUnavailableDates(dates) {
  if (!dates) return [];
  if (!Array.isArray(dates)) {
    const err = new Error('unavailable_dates must be an array');
    err.statusCode = 400;
    throw err;
  }
  if (dates.length > 30) {
    const err = new Error('Maximum 30 unavailable dates');
    err.statusCode = 400;
    throw err;
  }
  return [...new Set(dates.map((d) => assertDate(d, 'Unavailable date')))];
}

function dateInWindows(date, windows) {
  return windows.some((w) => date >= String(w.start_date).slice(0, 10) && date <= String(w.end_date).slice(0, 10));
}

function dateUnavailable(date, unavailableDates) {
  return unavailableDates.some((d) => date === String(d.unavailable_date || d).slice(0, 10));
}

function assertMatches({ requesterProfile, listing, listingWindows, listingUnavailable, reverseListing, reverseWindows, reverseUnavailable }) {
  if (!hasOfficialTest(requesterProfile)) {
    const err = new Error('Add your official test date, time and centre to your profile first');
    err.statusCode = 409;
    err.code = 'PROFILE_INCOMPLETE';
    throw err;
  }

  const requesterCentre = normalizeCentre(requesterProfile.test_centre).toLowerCase();
  const listingCentre = normalizeCentre(listing.test_centre).toLowerCase();
  if (requesterCentre !== listingCentre) {
    const err = new Error('Test swaps must use the same test centre');
    err.statusCode = 409;
    err.code = 'CENTRE_MISMATCH';
    throw err;
  }

  const requesterDate = String(requesterProfile.test_date).slice(0, 10);
  if (!dateInWindows(requesterDate, listingWindows)) {
    const err = new Error('Your official test date is outside this learner\'s acceptable replacement windows');
    err.statusCode = 409;
    err.code = 'DATE_WINDOW_MISMATCH';
    throw err;
  }
  if (dateUnavailable(requesterDate, listingUnavailable)) {
    const err = new Error('Your official test date is listed as unavailable for this learner');
    err.statusCode = 409;
    err.code = 'UNAVAILABLE_DATE';
    throw err;
  }

  if (reverseListing) {
    const offeredDate = String(listing.test_date).slice(0, 10);
    if (!dateInWindows(offeredDate, reverseWindows)) {
      const err = new Error('Their offered test date is outside your acceptable replacement windows');
      err.statusCode = 409;
      err.code = 'REVERSE_DATE_WINDOW_MISMATCH';
      throw err;
    }
    if (dateUnavailable(offeredDate, reverseUnavailable)) {
      const err = new Error('Their offered test date is one of your unavailable dates');
      err.statusCode = 409;
      err.code = 'REVERSE_UNAVAILABLE_DATE';
      throw err;
    }
  }
}

async function getLearnerProfile(sql, learnerId, schoolId) {
  const [profile] = await sql`
    SELECT id, name, email, phone,
           test_date::text AS test_date,
           test_time,
           test_centre
    FROM learner_users
    WHERE id = ${learnerId}
      AND school_id = ${schoolId}
  `;
  return profile || null;
}

async function getListingChildren(sql, listingIds, schoolId) {
  if (!listingIds.length) return { windowsByListing: new Map(), unavailableByListing: new Map() };

  const windows = await sql`
    SELECT listing_id, start_date::text AS start_date, end_date::text AS end_date
    FROM test_swap_windows
    WHERE school_id = ${schoolId}
      AND listing_id = ANY(${listingIds})
    ORDER BY start_date, end_date
  `;
  const unavailable = await sql`
    SELECT listing_id, unavailable_date::text AS unavailable_date
    FROM test_swap_unavailable_dates
    WHERE school_id = ${schoolId}
      AND listing_id = ANY(${listingIds})
    ORDER BY unavailable_date
  `;

  const windowsByListing = new Map();
  const unavailableByListing = new Map();
  for (const row of windows) {
    if (!windowsByListing.has(row.listing_id)) windowsByListing.set(row.listing_id, []);
    windowsByListing.get(row.listing_id).push(row);
  }
  for (const row of unavailable) {
    if (!unavailableByListing.has(row.listing_id)) unavailableByListing.set(row.listing_id, []);
    unavailableByListing.get(row.listing_id).push(row.unavailable_date);
  }
  return { windowsByListing, unavailableByListing };
}

async function attachListingChildren(sql, listings, schoolId) {
  const ids = listings.map((l) => l.id);
  const { windowsByListing, unavailableByListing } = await getListingChildren(sql, ids, schoolId);
  return listings.map((listing) => ({
    ...listing,
    windows: windowsByListing.get(listing.id) || [],
    unavailable_dates: unavailableByListing.get(listing.id) || [],
  }));
}

async function getActiveListingForLearner(sql, learnerId, schoolId) {
  const [listing] = await sql`
    SELECT id, school_id, learner_id, test_date::text AS test_date, test_time,
           test_centre, status, created_at, updated_at, cancelled_at, completed_at
    FROM test_swap_listings
    WHERE learner_id = ${learnerId}
      AND school_id = ${schoolId}
      AND status IN (${LISTING_ACTIVE}, ${LISTING_ACCEPTED})
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return listing || null;
}

async function loadListingWithChildren(sql, listingId, schoolId) {
  const [listing] = await sql`
    SELECT id, school_id, learner_id, test_date::text AS test_date, test_time,
           test_centre, status, created_at, updated_at, cancelled_at, completed_at
    FROM test_swap_listings
    WHERE id = ${listingId}
      AND school_id = ${schoolId}
  `;
  if (!listing) return null;
  const [withChildren] = await attachListingChildren(sql, [listing], schoolId);
  return withChildren;
}

async function handleLearnerSummary(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = getSql();
    const profile = await getLearnerProfile(sql, user.id, schoolId);
    if (!profile) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Learner not found' });

    const eligible = hasOfficialTest(profile);
    const myListing = await getActiveListingForLearner(sql, user.id, schoolId);
    const [myListingWithChildren] = myListing ? await attachListingChildren(sql, [myListing], schoolId) : [null];

    const listings = eligible
      ? await sql`
          SELECT l.id, l.test_date::text AS test_date, l.test_time, l.test_centre,
                 l.status, l.created_at, l.updated_at,
                 EXISTS (
                   SELECT 1 FROM test_swap_requests r
                   WHERE r.listing_id = l.id
                     AND r.school_id = ${schoolId}
                     AND r.requester_learner_id = ${user.id}
                     AND r.status IN (${REQUEST_PENDING}, ${REQUEST_ACCEPTED})
                 ) AS has_open_request,
                 (
                   SELECT r.status FROM test_swap_requests r
                   WHERE r.listing_id = l.id
                     AND r.school_id = ${schoolId}
                     AND r.requester_learner_id = ${user.id}
                   ORDER BY r.created_at DESC
                   LIMIT 1
                 ) AS my_request_status,
                 (
                   SELECT COUNT(*)::int FROM test_swap_requests r
                   WHERE r.listing_id = l.id
                     AND r.school_id = ${schoolId}
                     AND r.status = ${REQUEST_PENDING}
                 ) AS pending_request_count
          FROM test_swap_listings l
          WHERE l.school_id = ${schoolId}
            AND l.status = ${LISTING_ACTIVE}
            AND l.learner_id <> ${user.id}
            AND lower(trim(l.test_centre)) = lower(trim(${profile.test_centre}))
            AND NOT EXISTS (
              SELECT 1 FROM test_swap_requests ar
              WHERE ar.listing_id = l.id
                AND ar.school_id = ${schoolId}
                AND ar.status = ${REQUEST_ACCEPTED}
            )
          ORDER BY l.test_date ASC, l.test_time ASC, l.created_at ASC
        `
      : [];

    const myRequests = await sql`
      SELECT r.id, r.listing_id, r.status, r.created_at, r.accepted_at,
             r.declined_at, r.withdrawn_at, r.completed_at,
             r.requester_test_date_snapshot::text AS requester_test_date_snapshot,
             r.requester_test_time_snapshot,
             r.requester_test_centre_snapshot,
             l.test_date::text AS offered_test_date,
             l.test_time AS offered_test_time,
             l.test_centre AS offered_test_centre,
             l.status AS listing_status
      FROM test_swap_requests r
      JOIN test_swap_listings l
        ON l.id = r.listing_id
       AND l.school_id = ${schoolId}
      WHERE r.requester_learner_id = ${user.id}
        AND r.school_id = ${schoolId}
      ORDER BY r.created_at DESC
      LIMIT 50
    `;

    const incomingRequests = await sql`
      SELECT r.id, r.listing_id, r.status, r.created_at, r.accepted_at,
             r.declined_at, r.withdrawn_at, r.completed_at,
             r.requester_test_date_snapshot::text AS requester_test_date_snapshot,
             r.requester_test_time_snapshot,
             r.requester_test_centre_snapshot,
             l.test_date::text AS offered_test_date,
             l.test_time AS offered_test_time,
             l.test_centre AS offered_test_centre,
             l.status AS listing_status
      FROM test_swap_requests r
      JOIN test_swap_listings l
        ON l.id = r.listing_id
       AND l.school_id = ${schoolId}
      WHERE l.learner_id = ${user.id}
        AND r.school_id = ${schoolId}
        AND r.status IN (${REQUEST_PENDING}, ${REQUEST_ACCEPTED}, ${REQUEST_DECLINED}, ${REQUEST_WITHDRAWN}, ${REQUEST_COMPLETED})
      ORDER BY CASE WHEN r.status = ${REQUEST_PENDING} THEN 0 ELSE 1 END,
               r.created_at DESC
      LIMIT 50
    `;

    const [countRow] = await pendingIncomingCount(sql, user.id, schoolId);

    return res.json({
      ok: true,
      profile: {
        ...profile,
        official_test_date: profile.test_date,
        official_test_time: profile.test_time,
        official_test_centre: profile.test_centre,
      },
      eligible,
      my_listing: myListingWithChildren,
      listings: await attachListingChildren(sql, listings, schoolId),
      incoming_requests: incomingRequests,
      my_requests: myRequests,
      notification_count: countRow?.count || 0,
    });
  } catch (err) {
    console.error('test-swaps summary error:', err);
    reportError('/api/test-swaps?action=summary', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load test swaps' });
  }
}

async function pendingIncomingCount(sql, learnerId, schoolId) {
  return sql`
    SELECT COUNT(*)::int AS count
    FROM test_swap_requests r
    JOIN test_swap_listings l
      ON l.id = r.listing_id
     AND l.school_id = ${schoolId}
    WHERE l.learner_id = ${learnerId}
      AND r.school_id = ${schoolId}
      AND r.status = ${REQUEST_PENDING}
      AND l.status = ${LISTING_ACTIVE}
  `;
}

async function handleNotificationCount(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = getSql();
    const [row] = await pendingIncomingCount(sql, user.id, schoolId);
    return res.json({ ok: true, count: row?.count || 0 });
  } catch (err) {
    console.error('test-swaps notification-count error:', err);
    reportError('/api/test-swaps?action=notification-count', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load notification count' });
  }
}

async function handleCreateListing(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const windows = normalizeWindows(req.body?.windows || req.body?.replacement_windows);
    const unavailableDates = normalizeUnavailableDates(req.body?.unavailable_dates);
    const sql = getSql();
    const profile = await getLearnerProfile(sql, user.id, schoolId);
    if (!hasOfficialTest(profile)) {
      return res.status(409).json({ error: true, code: 'PROFILE_INCOMPLETE', message: 'Add your official test date, time and centre to your profile first' });
    }

    assertTime(profile.test_time, 'Official test time');
    const centre = normalizeCentre(profile.test_centre);
    if (centre.length > 160) return res.status(400).json({ error: true, code: 'CENTRE_TOO_LONG', message: 'Test centre is too long' });

    const [existing] = await sql`
      SELECT id FROM test_swap_listings
      WHERE learner_id = ${user.id}
        AND school_id = ${schoolId}
        AND status IN (${LISTING_ACTIVE}, ${LISTING_ACCEPTED})
      LIMIT 1
    `;
    if (existing) {
      return res.status(409).json({ error: true, code: 'ACTIVE_LISTING_EXISTS', message: 'You already have an active test swap listing' });
    }

    const [listing] = await sql`
      INSERT INTO test_swap_listings (school_id, learner_id, test_date, test_time, test_centre, status)
      VALUES (${schoolId}, ${user.id}, ${profile.test_date}, ${profile.test_time}, ${centre}, ${LISTING_ACTIVE})
      RETURNING id, school_id, learner_id, test_date::text AS test_date, test_time,
                test_centre, status, created_at, updated_at
    `;

    for (const w of windows) {
      await sql`
        INSERT INTO test_swap_windows (listing_id, school_id, start_date, end_date)
        VALUES (${listing.id}, ${schoolId}, ${w.start_date}, ${w.end_date})
      `;
    }
    for (const d of unavailableDates) {
      await sql`
        INSERT INTO test_swap_unavailable_dates (listing_id, school_id, unavailable_date)
        VALUES (${listing.id}, ${schoolId}, ${d})
      `;
    }

    const [withChildren] = await attachListingChildren(sql, [listing], schoolId);
    return res.json({ ok: true, listing: withChildren });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: true, code: err.code || 'VALIDATION_ERROR', message: err.message });
    if (err.message && err.message.includes('uq_test_swap_one_open_listing_per_learner')) {
      return res.status(409).json({ error: true, code: 'ACTIVE_LISTING_EXISTS', message: 'You already have an active test swap listing' });
    }
    console.error('test-swaps create-listing error:', err);
    reportError('/api/test-swaps?action=create-listing', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to create listing' });
  }
}

async function handleDeleteListing(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const listingId = parseInt(req.body?.listing_id, 10);
  if (!listingId) return res.status(400).json({ error: true, code: 'LISTING_REQUIRED', message: 'listing_id is required' });

  try {
    const sql = getSql();
    const [listing] = await sql`
      UPDATE test_swap_listings
      SET status = ${LISTING_CANCELLED},
          cancelled_at = NOW(),
          updated_at = NOW()
      WHERE id = ${listingId}
        AND learner_id = ${user.id}
        AND school_id = ${schoolId}
        AND status = ${LISTING_ACTIVE}
      RETURNING id
    `;
    if (!listing) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Active listing not found' });
    await sql`
      UPDATE test_swap_requests
      SET status = ${REQUEST_DECLINED},
          declined_at = COALESCE(declined_at, NOW())
      WHERE listing_id = ${listingId}
        AND school_id = ${schoolId}
        AND status = ${REQUEST_PENDING}
    `;
    return res.json({ ok: true });
  } catch (err) {
    console.error('test-swaps delete-listing error:', err);
    reportError('/api/test-swaps?action=delete-listing', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to delete listing' });
  }
}

async function handleRequestListing(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const listingId = parseInt(req.body?.listing_id, 10);
  if (!listingId) return res.status(400).json({ error: true, code: 'LISTING_REQUIRED', message: 'listing_id is required' });

  try {
    const sql = getSql();
    const requesterProfile = await getLearnerProfile(sql, user.id, schoolId);
    const listing = await loadListingWithChildren(sql, listingId, schoolId);
    if (!listing || listing.status !== LISTING_ACTIVE) {
      return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Active listing not found' });
    }
    if (listing.learner_id === user.id) {
      return res.status(409).json({ error: true, code: 'OWN_LISTING', message: 'You cannot request your own listing' });
    }

    const [accepted] = await sql`
      SELECT id FROM test_swap_requests
      WHERE listing_id = ${listing.id}
        AND school_id = ${schoolId}
        AND status = ${REQUEST_ACCEPTED}
      LIMIT 1
    `;
    if (accepted) return res.status(409).json({ error: true, code: 'ALREADY_ACCEPTED', message: 'This listing already has an accepted request' });

    const reverseListing = await getActiveListingForLearner(sql, user.id, schoolId);
    let reverseWindows = [];
    let reverseUnavailable = [];
    if (reverseListing) {
      const withChildren = await loadListingWithChildren(sql, reverseListing.id, schoolId);
      reverseWindows = withChildren.windows;
      reverseUnavailable = withChildren.unavailable_dates;
    }

    assertMatches({
      requesterProfile,
      listing,
      listingWindows: listing.windows,
      listingUnavailable: listing.unavailable_dates,
      reverseListing,
      reverseWindows,
      reverseUnavailable,
    });

    const [requestRow] = await sql`
      INSERT INTO test_swap_requests (
        school_id, listing_id, requester_learner_id,
        requester_test_date_snapshot, requester_test_time_snapshot,
        requester_test_centre_snapshot, status
      ) VALUES (
        ${schoolId}, ${listing.id}, ${user.id},
        ${requesterProfile.test_date}, ${requesterProfile.test_time},
        ${normalizeCentre(requesterProfile.test_centre)}, ${REQUEST_PENDING}
      )
      RETURNING id, listing_id, status, created_at,
                requester_test_date_snapshot::text AS requester_test_date_snapshot,
                requester_test_time_snapshot,
                requester_test_centre_snapshot
    `;

    await notifyListingOwner(sql, { listing, requestRow, requesterProfile, schoolId });
    return res.json({ ok: true, request: requestRow });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: true, code: err.code || 'VALIDATION_ERROR', message: err.message });
    if (err.message && err.message.includes('uq_test_swap_pending_request_per_listing')) {
      return res.status(409).json({ error: true, code: 'REQUEST_EXISTS', message: 'You already have a pending request for this listing' });
    }
    console.error('test-swaps request-listing error:', err);
    reportError('/api/test-swaps?action=request-listing', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to request listing' });
  }
}

async function notifyListingOwner(sql, { listing, requestRow, requesterProfile, schoolId }) {
  const [owner] = await sql`
    SELECT id, name, email, phone
    FROM learner_users
    WHERE id = ${listing.learner_id}
      AND school_id = ${schoolId}
  `;
  if (!owner) return;

  const pageUrl = `${process.env.BASE_URL || 'https://coachcarter.uk'}/learner/test-swaps.html`;
  const subject = 'New driving test swap request';
  const text =
    `Someone has requested your ${listing.test_centre} test swap.\n\n` +
    `They can offer ${requesterProfile.test_date} at ${String(requesterProfile.test_time || '').slice(0, 5)}.\n\n` +
    `Review it here: ${pageUrl}`;
  const html =
    `<p>Someone has requested your ${escapeHtml(listing.test_centre)} test swap.</p>` +
    `<p>They can offer <strong>${escapeHtml(requesterProfile.test_date)}</strong> at <strong>${escapeHtml(String(requesterProfile.test_time || '').slice(0, 5))}</strong>.</p>` +
    `<p><a href="${escapeHtml(pageUrl)}">Review the request</a></p>`;

  const tasks = [];
  if (owner.email) {
    const mailer = createTransporter();
    tasks.push(mailer.sendMail({
      from: process.env.SMTP_USER,
      to: owner.email,
      subject,
      text,
      html,
      _log: {
        purpose: 'test_swap.incoming_request',
        learnerId: owner.id,
        schoolId,
      },
    }));
  }
  if (owner.phone) {
    tasks.push(sendWhatsApp(owner.phone, text, {
      purpose: 'test_swap.incoming_request',
      learnerId: owner.id,
      schoolId,
    }));
  }
  if (tasks.length) await Promise.allSettled(tasks);
}

async function handleAcceptRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const requestId = parseInt(req.body?.request_id, 10);
  if (!requestId) return res.status(400).json({ error: true, code: 'REQUEST_REQUIRED', message: 'request_id is required' });

  try {
    const sql = getSql();
    const [accepted] = await sql`
      UPDATE test_swap_requests r
      SET status = ${REQUEST_ACCEPTED},
          accepted_at = NOW()
      FROM test_swap_listings l
      WHERE r.id = ${requestId}
        AND r.school_id = ${schoolId}
        AND r.status = ${REQUEST_PENDING}
        AND l.id = r.listing_id
        AND l.school_id = ${schoolId}
        AND l.learner_id = ${user.id}
        AND l.status = ${LISTING_ACTIVE}
        AND NOT EXISTS (
          SELECT 1 FROM test_swap_requests ar
          WHERE ar.listing_id = r.listing_id
            AND ar.school_id = ${schoolId}
            AND ar.status = ${REQUEST_ACCEPTED}
        )
      RETURNING r.id, r.listing_id, r.requester_learner_id, r.status, r.accepted_at
    `;
    if (!accepted) {
      return res.status(409).json({ error: true, code: 'NOT_ACCEPTABLE', message: 'Request is no longer pending or the listing already has an accepted request' });
    }

    await sql`
      UPDATE test_swap_listings
      SET status = ${LISTING_ACCEPTED},
          updated_at = NOW()
      WHERE id = ${accepted.listing_id}
        AND school_id = ${schoolId}
        AND learner_id = ${user.id}
    `;
    await sql`
      UPDATE test_swap_requests
      SET status = ${REQUEST_DECLINED},
          declined_at = COALESCE(declined_at, NOW())
      WHERE listing_id = ${accepted.listing_id}
        AND school_id = ${schoolId}
        AND status = ${REQUEST_PENDING}
        AND id <> ${accepted.id}
    `;

    return res.json({ ok: true, request: accepted });
  } catch (err) {
    if (err.message && err.message.includes('uq_test_swap_one_accepted_request_per_listing')) {
      return res.status(409).json({ error: true, code: 'ALREADY_ACCEPTED', message: 'This listing already has an accepted request' });
    }
    console.error('test-swaps accept-request error:', err);
    reportError('/api/test-swaps?action=accept-request', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to accept request' });
  }
}

async function handleDeclineRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const requestId = parseInt(req.body?.request_id, 10);
  if (!requestId) return res.status(400).json({ error: true, code: 'REQUEST_REQUIRED', message: 'request_id is required' });

  try {
    const sql = getSql();
    const [row] = await sql`
      UPDATE test_swap_requests r
      SET status = ${REQUEST_DECLINED},
          declined_at = NOW()
      FROM test_swap_listings l
      WHERE r.id = ${requestId}
        AND r.school_id = ${schoolId}
        AND r.status = ${REQUEST_PENDING}
        AND l.id = r.listing_id
        AND l.school_id = ${schoolId}
        AND l.learner_id = ${user.id}
        AND l.status = ${LISTING_ACTIVE}
      RETURNING r.id, r.status, r.declined_at
    `;
    if (!row) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Pending request not found' });
    return res.json({ ok: true, request: row });
  } catch (err) {
    console.error('test-swaps decline-request error:', err);
    reportError('/api/test-swaps?action=decline-request', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to decline request' });
  }
}

async function handleWithdrawRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const user = requireAuth(req, { roles: ['learner'] });
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const requestId = parseInt(req.body?.request_id, 10);
  if (!requestId) return res.status(400).json({ error: true, code: 'REQUEST_REQUIRED', message: 'request_id is required' });

  try {
    const sql = getSql();
    const [row] = await sql`
      UPDATE test_swap_requests
      SET status = ${REQUEST_WITHDRAWN},
          withdrawn_at = NOW()
      WHERE id = ${requestId}
        AND requester_learner_id = ${user.id}
        AND school_id = ${schoolId}
        AND status = ${REQUEST_PENDING}
      RETURNING id, listing_id, status, withdrawn_at
    `;
    if (!row) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Pending request not found' });
    return res.json({ ok: true, request: row });
  } catch (err) {
    console.error('test-swaps withdraw-request error:', err);
    reportError('/api/test-swaps?action=withdraw-request', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to withdraw request' });
  }
}

async function handleAdminAccepted(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = getSchoolId(admin, req);
  if (!schoolId) return res.status(400).json({ error: true, code: 'SCHOOL_REQUIRED', message: 'school_id is required' });

  try {
    const sql = getSql();
    const requests = await sql`
      SELECT r.id, r.status, r.created_at, r.accepted_at, r.completed_at,
             r.requester_test_date_snapshot::text AS requester_test_date_snapshot,
             r.requester_test_time_snapshot,
             r.requester_test_centre_snapshot,
             l.id AS listing_id,
             l.status AS listing_status,
             l.test_date::text AS listing_test_date,
             l.test_time AS listing_test_time,
             l.test_centre AS test_centre,
             owner.id AS owner_learner_id,
             owner.name AS owner_name,
             owner.email AS owner_email,
             owner.phone AS owner_phone,
             requester.id AS requester_learner_id,
             requester.name AS requester_name,
             requester.email AS requester_email,
             requester.phone AS requester_phone
      FROM test_swap_requests r
      JOIN test_swap_listings l
        ON l.id = r.listing_id
       AND l.school_id = ${schoolId}
      JOIN learner_users owner
        ON owner.id = l.learner_id
       AND owner.school_id = ${schoolId}
      JOIN learner_users requester
        ON requester.id = r.requester_learner_id
       AND requester.school_id = ${schoolId}
      WHERE r.school_id = ${schoolId}
        AND r.status = ${REQUEST_ACCEPTED}
        AND l.status = ${LISTING_ACCEPTED}
      ORDER BY r.accepted_at ASC NULLS LAST, r.created_at ASC
    `;

    return res.json({ ok: true, requests });
  } catch (err) {
    console.error('test-swaps admin-accepted error:', err);
    reportError('/api/test-swaps?action=admin-accepted', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to load accepted test swaps' });
  }
}

async function handleAdminComplete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = getSchoolId(admin, req);
  if (!schoolId) return res.status(400).json({ error: true, code: 'SCHOOL_REQUIRED', message: 'school_id is required' });
  const requestId = parseInt(req.body?.request_id, 10);
  if (!requestId) return res.status(400).json({ error: true, code: 'REQUEST_REQUIRED', message: 'request_id is required' });

  try {
    const sql = getSql();
    const [requestRow] = await sql`
      SELECT r.id, r.listing_id, r.requester_learner_id, l.learner_id AS owner_learner_id
      FROM test_swap_requests r
      JOIN test_swap_listings l
        ON l.id = r.listing_id
       AND l.school_id = ${schoolId}
      WHERE r.id = ${requestId}
        AND r.school_id = ${schoolId}
        AND r.status = ${REQUEST_ACCEPTED}
        AND l.status = ${LISTING_ACCEPTED}
    `;
    if (!requestRow) return res.status(404).json({ error: true, code: 'NOT_FOUND', message: 'Accepted test swap not found' });

    await sql`
      UPDATE test_swap_requests
      SET status = ${REQUEST_COMPLETED},
          completed_at = NOW()
      WHERE id = ${requestId}
        AND school_id = ${schoolId}
        AND status = ${REQUEST_ACCEPTED}
    `;
    await sql`
      UPDATE test_swap_listings
      SET status = ${LISTING_COMPLETED},
          completed_at = NOW(),
          updated_at = NOW()
      WHERE school_id = ${schoolId}
        AND learner_id IN (${requestRow.owner_learner_id}, ${requestRow.requester_learner_id})
        AND status IN (${LISTING_ACTIVE}, ${LISTING_ACCEPTED})
    `;

    await logAudit(sql, {
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'test_swap.complete',
      targetType: 'test_swap_request',
      targetId: requestId,
      details: {
        listing_id: requestRow.listing_id,
        owner_learner_id: requestRow.owner_learner_id,
        requester_learner_id: requestRow.requester_learner_id,
      },
      schoolId,
      req,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('test-swaps admin-complete error:', err);
    reportError('/api/test-swaps?action=admin-complete', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Failed to complete test swap' });
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports._private = {
  normalizeCentre,
  normalizeWindows,
  normalizeUnavailableDates,
  dateInWindows,
  dateUnavailable,
  assertMatches,
};
