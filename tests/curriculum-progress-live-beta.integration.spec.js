// Persistent, explicitly gated rehearsal against the dedicated Codex Neon test database.
// This test resets only labelled Codex fixtures and leaves the completed rehearsal data
// in place for inspection. It must never run against production.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const jwt = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');

(function loadDatabaseEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const allowed = new Set(['POSTGRES_URL', 'POSTGRES_URL_TEST', 'JWT_SECRET']);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || !allowed.has(match[1]) || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1'
  && process.env.CC_TEST_DB_CONFIRMED_NON_PRODUCTION === '1'
  && process.env.CC_TEST_CURRICULUM_LIVE === '1'
  && !!process.env.POSTGRES_URL_TEST;
const EXPECTED_TEST_HOSTNAME = 'ep-shy-mode-za3r7anf.c-2.eu-west-2.aws.neon.tech';

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
  };
}

async function call(handler, { method = 'GET', action, query = {}, body = {}, headers = {} }) {
  const req = {
    method,
    url: `/api/curriculum-progress?action=${action}`,
    query: { action, ...query },
    body,
    headers,
  };
  const res = response();
  await handler(req, res);
  return res;
}

function cookieHeaders(token, role, csrf = null) {
  const cookieName = role === 'instructor' ? 'cc_instructor' : 'cc_learner';
  const cookie = [`${cookieName}=${encodeURIComponent(token)}`];
  const headers = {};
  if (csrf) {
    cookie.push(`cc_csrf=${csrf}`);
    headers['x-csrf-token'] = csrf;
  }
  headers.cookie = cookie.join('; ');
  return headers;
}

async function startLocalCurriculumServer(curriculumHandler) {
  const publicRoot = path.resolve(__dirname, '..', 'public');
  const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/curriculum-progress') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const rawBody = Buffer.concat(chunks).toString('utf8');
        req.query = Object.fromEntries(url.searchParams.entries());
        req.body = rawBody ? JSON.parse(rawBody) : {};
        const apiRes = {
          status(code) { res.statusCode = code; return this; },
          setHeader(name, value) { res.setHeader(name, value); },
          getHeader(name) { return res.getHeader(name); },
          json(body) {
            if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(body));
            return this;
          },
        };
        await curriculumHandler(req, apiRes);
        return;
      }

      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      let filePath = path.resolve(publicRoot, relative || 'index.html');
      if (!filePath.startsWith(publicRoot + path.sep) && filePath !== publicRoot) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test.describe.configure({ mode: 'serial' });
test.describe('curriculum progress persistent non-production rehearsal', () => {
  test.skip(
    !ENABLED,
    'Requires the three non-production gates plus CC_TEST_CURRICULUM_LIVE=1'
  );

  test('runs disabled, enabled, instructor-review, learner-reflection and progress flows', async () => {
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST) {
      throw new Error('REFUSING: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    if (new URL(process.env.POSTGRES_URL_TEST).hostname !== EXPECTED_TEST_HOSTNAME) {
      throw new Error('REFUSING: POSTGRES_URL_TEST is not the confirmed dedicated endpoint');
    }
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for authenticated rehearsal');

    const { seedCodexTestData } = require('../api/_codex-test-data');
    const sql = neon(process.env.POSTGRES_URL_TEST);
    const seeded = await seedCodexTestData();
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;
    const curriculumHandler = require('../api/curriculum-progress');
    const learner = seeded.accounts.learner_full;
    const otherLearner = seeded.accounts.learner_delete;
    const instructor = seeded.accounts.instructor;

    await sql`
      UPDATE schools
      SET config = jsonb_set(
        COALESCE(config, '{}'::jsonb),
        '{features}',
        (CASE
          WHEN jsonb_typeof(config->'features') = 'object' THEN config->'features'
          ELSE '{}'::jsonb
        END) || jsonb_build_object('curriculum_progress_beta', false),
        true
      )
      WHERE id = ${Number(learner.school_id)}
    `;

    const instructorToken = jwt.sign({
      id: instructor.id,
      email: instructor.email,
      role: 'instructor',
      school_id: instructor.school_id,
    }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const learnerToken = jwt.sign({
      id: learner.id,
      email: learner.email,
      role: 'learner',
      school_id: learner.school_id,
    }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const wrongInstructorToken = jwt.sign({
      id: Number(instructor.id) + 999999,
      email: 'codex+wrong-instructor@coachcarter.test',
      role: 'instructor',
      school_id: instructor.school_id,
    }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const instructorGet = cookieHeaders(instructorToken, 'instructor');
    const learnerGet = cookieHeaders(learnerToken, 'learner');
    const instructorPost = cookieHeaders(instructorToken, 'instructor', 'curriculum-live-instructor-csrf');
    const learnerPost = cookieHeaders(learnerToken, 'learner', 'curriculum-live-learner-csrf');

    const disabledInstructor = await call(curriculumHandler, {
      action: 'feature-state', headers: instructorGet,
    });
    const disabledLearner = await call(curriculumHandler, {
      action: 'feature-state', headers: learnerGet,
    });
    expect(disabledInstructor.statusCode).toBe(200);
    expect(disabledInstructor.body).toMatchObject({ ok: true, enabled: false });
    expect(disabledLearner.statusCode).toBe(200);
    expect(disabledLearner.body).toMatchObject({ ok: true, enabled: false });

    await sql`
      UPDATE schools
      SET config = jsonb_set(
        COALESCE(config, '{}'::jsonb),
        '{features}',
        (CASE
          WHEN jsonb_typeof(config->'features') = 'object' THEN config->'features'
          ELSE '{}'::jsonb
        END) || jsonb_build_object('curriculum_progress_beta', true),
        true
      )
      WHERE id = ${Number(learner.school_id)}
    `;
    const [flag] = await sql`
      SELECT config->'features'->'curriculum_progress_beta' AS value,
             jsonb_typeof(config->'features'->'curriculum_progress_beta') AS value_type
      FROM schools
      WHERE id = ${Number(learner.school_id)}
    `;
    expect(flag).toEqual({ value: true, value_type: 'boolean' });

    const enabledInstructor = await call(curriculumHandler, {
      action: 'feature-state', headers: instructorGet,
    });
    const enabledLearner = await call(curriculumHandler, {
      action: 'feature-state', headers: learnerGet,
    });
    expect(enabledInstructor.body.enabled).toBe(true);
    expect(enabledLearner.body.enabled).toBe(true);

    const due = await call(curriculumHandler, { action: 'reviews-due', headers: instructorGet });
    expect(due.statusCode).toBe(200);
    expect(due.body.enabled).toBe(true);
    const pastBookings = await sql`
      SELECT id FROM lesson_bookings
      WHERE school_id = ${Number(learner.school_id)}
        AND learner_id = ${Number(learner.id)}
        AND instructor_id = ${Number(instructor.id)}
        AND scheduled_date < CURRENT_DATE
      ORDER BY scheduled_date DESC, id DESC
    `;
    expect(pastBookings).toHaveLength(2);
    const dueIds = due.body.reviews.map((row) => Number(row.booking_id));
    expect(dueIds).toEqual(expect.arrayContaining(pastBookings.map((row) => Number(row.id))));
    const bookingId = Number(pastBookings[0].id);

    const [otherBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE school_id = ${Number(otherLearner.school_id)}
        AND learner_id = ${Number(otherLearner.id)}
      ORDER BY id DESC LIMIT 1
    `;
    const wrongLearnerAccess = await call(curriculumHandler, {
      action: 'reflection', query: { booking_id: otherBooking.id }, headers: learnerGet,
    });
    const wrongInstructorAccess = await call(curriculumHandler, {
      action: 'review', query: { booking_id: bookingId },
      headers: cookieHeaders(wrongInstructorToken, 'instructor'),
    });
    expect(wrongLearnerAccess.statusCode).toBe(404);
    expect(wrongInstructorAccess.statusCode).toBe(404);

    const initialReview = await call(curriculumHandler, {
      action: 'review', query: { booking_id: bookingId }, headers: instructorGet,
    });
    expect(initialReview.statusCode).toBe(200);
    expect(initialReview.body.reviewable).toBe(true);

    const firstRequest = {
      booking_id: bookingId,
      client_request_id: 'live-instructor-review-001',
      ratings: [
        { item_key: 'MOVE-01', score: 2, note: 'Developing control' },
        { item_key: 'RNDB-03', score: 1, note: 'Needs earlier planning' },
      ],
      completions: ['SET-01'],
      note: 'Persistent test instructor review',
    };
    const firstSubmit = await call(curriculumHandler, {
      method: 'POST', action: 'submit-instructor-review', body: firstRequest, headers: instructorPost,
    });
    const exactRetry = await call(curriculumHandler, {
      method: 'POST', action: 'submit-instructor-review', body: firstRequest, headers: instructorPost,
    });
    expect(firstSubmit.statusCode).toBe(200);
    expect(firstSubmit.body.duplicate).toBe(false);
    expect(exactRetry.statusCode).toBe(200);
    expect(exactRetry.body).toMatchObject({
      duplicate: true,
      submission_id: firstSubmit.body.submission_id,
      booking_id: bookingId,
    });

    const editSubmit = await call(curriculumHandler, {
      method: 'POST',
      action: 'submit-instructor-review',
      headers: instructorPost,
      body: {
        ...firstRequest,
        client_request_id: 'live-instructor-review-002',
        ratings: [
          { item_key: 'MOVE-01', score: 3, note: 'Independent now' },
          { item_key: 'RNDB-03', score: 2, note: 'Improved planning' },
        ],
        completions: ['SET-01', 'SET-02'],
        note: 'Persistent test instructor review edit',
      },
    });
    expect(editSubmit.statusCode).toBe(200);
    expect(editSubmit.body.duplicate).toBe(false);

    const reflectionDue = await call(curriculumHandler, {
      action: 'reflection-due', headers: learnerGet,
    });
    expect(reflectionDue.statusCode).toBe(200);
    expect(reflectionDue.body.reviews.map((row) => Number(row.booking_id))).toContain(bookingId);

    const reflection = await call(curriculumHandler, {
      action: 'reflection', query: { booking_id: bookingId }, headers: learnerGet,
    });
    expect(reflection.statusCode).toBe(200);
    expect(reflection.body.instructor_ratings.map((row) => row.item_key)).toEqual(['MOVE-01', 'RNDB-03']);

    const learnerSubmit = await call(curriculumHandler, {
      method: 'POST',
      action: 'submit-learner-reflection',
      headers: learnerPost,
      body: {
        booking_id: bookingId,
        client_request_id: 'live-learner-reflection-001',
        ratings: [
          { item_key: 'MOVE-01', score: 3, note: 'Felt controlled' },
          { item_key: 'RNDB-03', score: 2, note: 'More practice needed' },
        ],
        note: 'Persistent test learner reflection',
      },
    });
    expect(learnerSubmit.statusCode).toBe(200);
    expect(learnerSubmit.body.duplicate).toBe(false);

    const learnerProgress = await call(curriculumHandler, {
      action: 'progress', headers: learnerGet,
    });
    const instructorProgress = await call(curriculumHandler, {
      action: 'progress', query: { learner_id: learner.id }, headers: instructorGet,
    });
    for (const progress of [learnerProgress, instructorProgress]) {
      expect(progress.statusCode).toBe(200);
      expect(progress.body.enabled).toBe(true);
      expect(progress.body.ratings).toHaveLength(4);
      expect(progress.body.completions.map((row) => row.item_key)).toEqual(['SET-02', 'SET-01']);
      expect(progress.body.history).toHaveLength(6);
    }

    const finalRows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM curriculum_review_submissions
          WHERE school_id = ${Number(learner.school_id)} AND booking_id = ${bookingId}) AS submissions,
        (SELECT COUNT(*)::int FROM curriculum_rating_events
          WHERE school_id = ${Number(learner.school_id)} AND booking_id = ${bookingId}) AS ratings,
        (SELECT COUNT(*)::int FROM curriculum_completion_events
          WHERE school_id = ${Number(learner.school_id)} AND booking_id = ${bookingId}) AS completions
    `;
    expect(finalRows[0]).toEqual({ submissions: 3, ratings: 6, completions: 2 });
  });

  test('submits a second past lesson through the real local instructor and learner pages', async ({ browser }) => {
    const curriculumHandler = require('../api/curriculum-progress');
    const sql = neon(process.env.POSTGRES_URL_TEST);
    const [instructor] = await sql`
      SELECT id, name, email, school_id FROM instructors
      WHERE email = 'codex+instructor@coachcarter.test'
    `;
    const [learner] = await sql`
      SELECT id, name, email, school_id FROM learner_users
      WHERE email = 'codex+learner-full@coachcarter.test'
    `;
    const [booking] = await sql`
      SELECT lb.id
      FROM lesson_bookings lb
      WHERE lb.school_id = ${Number(learner.school_id)}
        AND lb.learner_id = ${Number(learner.id)}
        AND lb.instructor_id = ${Number(instructor.id)}
        AND lb.scheduled_date < CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM curriculum_review_submissions crs
          WHERE crs.school_id = lb.school_id AND crs.booking_id = lb.id
        )
      ORDER BY lb.scheduled_date DESC, lb.id DESC
      LIMIT 1
    `;
    expect(booking).toBeTruthy();

    const local = await startLocalCurriculumServer(curriculumHandler);
    try {
      const instructorToken = jwt.sign({
        id: instructor.id,
        email: instructor.email,
        role: 'instructor',
        school_id: instructor.school_id,
      }, process.env.JWT_SECRET, { expiresIn: '15m' });
      const instructorContext = await browser.newContext({ baseURL: local.baseURL });
      await instructorContext.addCookies([
        { name: 'cc_instructor', value: instructorToken, url: local.baseURL, httpOnly: true, sameSite: 'Lax' },
        { name: 'cc_csrf', value: 'live-browser-instructor-csrf', url: local.baseURL, sameSite: 'Lax' },
      ]);
      await instructorContext.addInitScript((value) => {
        localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
        localStorage.setItem('cc_instructor', JSON.stringify({ instructor: value }));
      }, instructor);
      const instructorPage = await instructorContext.newPage();
      await instructorPage.setViewportSize({ width: 390, height: 844 });
      await instructorPage.goto(`/instructor/review-lesson?booking_id=${booking.id}`);
      await expect(instructorPage.getByText(learner.name)).toBeVisible();
      await instructorPage.getByText('Moving off and stopping', { exact: true }).click();
      const movingOff = instructorPage.locator('[data-skill="MOVE-01"]');
      await movingOff.check();
      await movingOff.locator('xpath=ancestor::div[contains(@class,"cp-item")]')
        .getByText('2 · Developing', { exact: true }).click();
      await instructorPage.getByText('Getting ready', { exact: true }).click();
      await instructorPage.locator('[data-completion="SET-03"]').check();
      await Promise.all([
        instructorPage.waitForURL('**/instructor/dashboard.html?review_saved=1'),
        instructorPage.getByRole('button', { name: 'Submit review' }).click(),
      ]);
      await instructorContext.close();

      const learnerToken = jwt.sign({
        id: learner.id,
        email: learner.email,
        role: 'learner',
        school_id: learner.school_id,
      }, process.env.JWT_SECRET, { expiresIn: '15m' });
      const learnerContext = await browser.newContext({ baseURL: local.baseURL });
      await learnerContext.addCookies([
        { name: 'cc_learner', value: learnerToken, url: local.baseURL, httpOnly: true, sameSite: 'Lax' },
        { name: 'cc_csrf', value: 'live-browser-learner-csrf', url: local.baseURL, sameSite: 'Lax' },
      ]);
      await learnerContext.addInitScript((value) => {
        localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
        localStorage.setItem('cc_learner', JSON.stringify({ user: value }));
      }, learner);
      const learnerPage = await learnerContext.newPage();
      await learnerPage.setViewportSize({ width: 390, height: 844 });
      await learnerPage.goto(`/learner/rate-lesson?booking_id=${booking.id}`);
      await expect(learnerPage.locator('.cp-card').filter({ hasText: 'MOVE-01' })).toBeVisible();
      await learnerPage.locator('.cp-card').filter({ hasText: 'MOVE-01' })
        .getByText('3 · Independent', { exact: true }).click();
      await Promise.all([
        learnerPage.waitForURL('**/learner/progress.html?reflection_saved=1'),
        learnerPage.getByRole('button', { name: 'Save reflection' }).click(),
      ]);
      await learnerContext.close();

      const [persisted] = await sql`
        SELECT
          (SELECT COUNT(*)::int FROM curriculum_review_submissions
            WHERE school_id = ${Number(learner.school_id)} AND booking_id = ${Number(booking.id)}) AS submissions,
          (SELECT COUNT(*)::int FROM curriculum_rating_events
            WHERE school_id = ${Number(learner.school_id)} AND booking_id = ${Number(booking.id)}) AS ratings,
          (SELECT COUNT(*)::int FROM curriculum_completion_events
            WHERE school_id = ${Number(learner.school_id)} AND booking_id = ${Number(booking.id)}) AS completions
      `;
      expect(persisted).toEqual({ submissions: 2, ratings: 2, completions: 1 });
    } finally {
      await local.close();
    }
  });
});
