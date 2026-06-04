const { test, expect } = require('./fixtures/auth');

const CODEX_LEARNER = 'codex+learner-full@coachcarter.test';
const CODEX_INSTRUCTOR = 'codex+instructor@coachcarter.test';

test.describe('Codex seeded test accounts', () => {
  test.beforeEach(({}, testInfo) => {
    if (!process.env.CC_TEST_API) {
      testInfo.skip(true, 'set CC_TEST_API=1 and run against vercel dev');
    }
  });

  test('learner logs in and reaches the dashboard', async ({ learnerPage }) => {
    await learnerPage.goto('/learner/index.html');

    await expect(learnerPage.locator('#welcome-msg')).toContainText(/Hi, Codex|Welcome!/);
    await expect(learnerPage.locator('#dashboard-skeleton')).toHaveCount(0);

    const authBlob = await learnerPage.evaluate(() => JSON.parse(localStorage.getItem('cc_learner') || '{}'));
    expect(authBlob.user?.email).toBe(process.env.CC_TEST_LEARNER_EMAIL);
  });

  test('learner opens booking page authenticated', async ({ learnerPage }) => {
    await learnerPage.goto('/learner/book.html');

    await expect(learnerPage.locator('.book-title')).toContainText('Book');
    await expect(learnerPage.locator('#calContent')).toBeVisible();

    const authBlob = await learnerPage.evaluate(() => JSON.parse(localStorage.getItem('cc_learner') || '{}'));
    expect(authBlob.user?.email).toBe(process.env.CC_TEST_LEARNER_EMAIL);
  });

  test('seeded learner credit balance displays', async ({ learnerPage }, testInfo) => {
    if (process.env.CC_TEST_LEARNER_EMAIL !== CODEX_LEARNER) {
      testInfo.skip(true, `set CC_TEST_LEARNER_EMAIL=${CODEX_LEARNER} for seeded balance assertions`);
    }

    await learnerPage.goto('/learner/index.html');

    await expect(learnerPage.locator('#stat-balance-value')).toHaveText('6');
    await expect(learnerPage.locator('#stat-balance-sub')).toHaveText('across instructors');
    await expect(learnerPage.locator('#credit-balance-line')).toContainText('6 hrs total credit across instructors');
  });

  test('instructor logs in and reaches dashboard', async ({ instructorPage }, testInfo) => {
    if (process.env.CC_TEST_INSTRUCTOR_EMAIL !== CODEX_INSTRUCTOR) {
      testInfo.skip(true, `set CC_TEST_INSTRUCTOR_EMAIL=${CODEX_INSTRUCTOR} for seeded instructor assertions`);
    }

    await instructorPage.goto('/instructor/dashboard.html');

    await expect(instructorPage.locator('#greeting')).toContainText('Codex');
    await expect(instructorPage.locator('#dashStats')).toContainText(/today/);
    await expect(instructorPage.locator('#dashLessons')).not.toContainText('Loading schedule');
    await expect(instructorPage.locator('#dashLessons')).toContainText('Codex Full Learner');
  });

  test('instructor opens schedule authenticated', async ({ instructorPage }, testInfo) => {
    if (process.env.CC_TEST_INSTRUCTOR_EMAIL !== CODEX_INSTRUCTOR) {
      testInfo.skip(true, `set CC_TEST_INSTRUCTOR_EMAIL=${CODEX_INSTRUCTOR} for seeded instructor assertions`);
    }

    await instructorPage.goto('/instructor/index.html');

    await expect(instructorPage.locator('#calContent')).toBeVisible();
    await expect(instructorPage.locator('#calContent')).not.toContainText('Loading');

    const authBlob = await instructorPage.evaluate(() => JSON.parse(localStorage.getItem('cc_instructor') || '{}'));
    expect(authBlob.instructor?.email).toBe(CODEX_INSTRUCTOR);
  });
});
