// @ts-check
// Curriculum MVP schema, security, interaction, and responsive contracts.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function consentAndInstructorScript() {
  return () => {
    localStorage.setItem('cc_instructor', JSON.stringify({
      instructor: {
        id: 7,
        name: 'Fraser Carter',
        email: 'fraser@example.com',
        school_id: 1
      }
    }));
    localStorage.setItem('cc_cookie_consent', JSON.stringify({
      analytics: false,
      version: 1,
      timestamp: '2026-07-30T09:00:00.000Z'
    }));
    localStorage.setItem('cc_dark_mode', 'dark');
  };
}

const bootstrapPayload = {
  ok: true,
  actor: { id: 7, type: 'instructor', name: 'Fraser Carter', is_admin: false },
  prompts: [
    { key: 'understand', label: 'What the learner needs to understand' },
    { key: 'demonstrate', label: 'What they need to demonstrate' },
    { key: 'mistakes', label: 'Common mistakes and misconceptions' },
    { key: 'approaches', label: 'Instructor teaching approaches' },
    { key: 'prerequisites', label: 'Prerequisite knowledge or skills' },
    { key: 'ready', label: 'Signs that the learner is ready to progress' },
    { key: 'thoughts', label: 'General thoughts' }
  ],
  topics: [
    {
      id: 1,
      name: 'Controls',
      description: 'Explore how learners understand and use the vehicle controls.',
      parent_topic_id: null,
      parent_name: null,
      contribution_count: 2,
      subtopic_count: 1,
      updated_at: '2026-07-30T08:00:00.000Z',
      last_activity_at: '2026-07-30T10:00:00.000Z'
    },
    {
      id: 4,
      name: 'Clutch control',
      description: 'Finding and using the biting point.',
      parent_topic_id: 1,
      parent_name: 'Controls',
      contribution_count: 1,
      subtopic_count: 0,
      updated_at: '2026-07-29T08:00:00.000Z',
      last_activity_at: '2026-07-29T08:00:00.000Z'
    },
    {
      id: 2,
      name: 'Junctions',
      description: 'Observation, judgement, and positioning.',
      parent_topic_id: null,
      parent_name: null,
      contribution_count: 0,
      subtopic_count: 0,
      updated_at: '2026-07-28T08:00:00.000Z',
      last_activity_at: '2026-07-28T08:00:00.000Z'
    },
    {
      id: 3,
      name: 'Manoeuvres',
      description: 'Teaching approaches and judgement.',
      parent_topic_id: null,
      parent_name: null,
      contribution_count: 0,
      subtopic_count: 0,
      updated_at: '2026-07-27T08:00:00.000Z',
      last_activity_at: '2026-07-27T08:00:00.000Z'
    }
  ],
  suggestions: []
};

test.describe('Curriculum MVP', () => {
  test.describe.configure({ mode: 'serial' });

  test('migration is tenant-owned, graph-ready, threaded, indexed, and non-destructive', () => {
    const full = read('db/migration.sql');
    const focused = read('db/migrations/038_curriculum_mvp.sql');

    for (const source of [full, focused]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS curriculum_topics');
      expect(source).toContain('school_id             INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
      expect(source).toContain('FOREIGN KEY (parent_topic_id, school_id)');
      expect(source).toContain('FOREIGN KEY (merged_into_topic_id, school_id)');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS curriculum_topic_connections');
      expect(source).toContain('UNIQUE (school_id, left_topic_id, right_topic_id)');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS curriculum_contributions');
      expect(source).toContain('parent_contribution_id');
      expect(source).toContain('FOREIGN KEY (parent_contribution_id, school_id)');
      expect(source).toContain('CONSTRAINT curriculum_contribution_link_contract CHECK');
      expect(source).toContain("response_type = 'connect_topic' AND linked_topic_id IS NOT NULL");
      expect(source).toContain('CREATE TABLE IF NOT EXISTS curriculum_structural_suggestions');
      expect(source).toContain('idx_curriculum_contributions_topic_prompt');
      expect(source).toContain('idx_curriculum_suggestions_school_status');
      expect(source).toContain("('Controls'");
      expect(source).toContain("('Junctions'");
      expect(source).toContain("('Manoeuvres'");
      expect(source).not.toMatch(/DELETE FROM curriculum_/);
    }
  });

  test('API requires an active same-school instructor or active school admin', () => {
    const api = read('api/curriculum.js');
    const resolve = functionBody(api, 'resolveActor');

    expect(resolve).toContain('requireAuth(req, {');
    expect(resolve).toContain("roles: ['admin', 'instructor']");
    expect(resolve).toContain('requireSchool: true');
    expect(resolve).toContain('const schoolId = getSchoolId(auth, req)');
    expect(resolve).toContain('FROM instructors');
    expect(resolve).toContain('AND school_id = ${schoolId}');
    expect(resolve).toContain("if (!instructor || !instructor.active)");
    expect(resolve).toContain('COALESCE(is_admin, FALSE) AS is_admin');
    expect(resolve).toContain('auth.isAdmin === true && instructor.is_admin === true');
    expect(resolve).toContain('FROM admin_users');
    expect(resolve).toContain('AND active = TRUE');
    expect(resolve).toContain("role !== 'admin'");
  });

  test('every read and mutation is scoped to the authenticated school', () => {
    const api = read('api/curriculum.js');
    const handlers = [
      'handleBootstrap',
      'handleTopic',
      'handleCreateTopic',
      'handleCreateConnection',
      'handleCreateContribution',
      'handleEditContribution',
      'handleSuggestStructure',
      'handleAdminTopic',
      'handleReviewSuggestion'
    ];
    handlers.forEach((name) => {
      expect(functionBody(api, name), name).toContain('actor.schoolId');
    });
    expect(api).not.toContain('req.body.school_id');
    expect(api).not.toContain('req.query.school_id');
    expect(api).toContain('WHERE t.school_id = ${actor.schoolId}');
    expect(api).toContain('WHERE c.school_id = ${actor.schoolId}');
    expect(api).toContain('WHERE connection.school_id = ${actor.schoolId}');
  });

  test('ownership and admin-only structural contracts are explicit', () => {
    const api = read('api/curriculum.js');
    const edit = functionBody(api, 'handleEditContribution');
    const admin = functionBody(api, 'handleAdminTopic');
    const review = functionBody(api, 'handleReviewSuggestion');

    expect(edit).toContain('existing.author_type !== actor.actorType');
    expect(edit).toContain('Number(existing.author_id) !== actor.actorId');
    expect(edit).toContain("'NOT_CONTRIBUTION_OWNER'");
    expect(edit).toContain('AND author_type = ${actor.actorType}');
    expect(edit).toContain('AND author_id = ${actor.actorId}');

    expect(admin).toContain('ensureAdmin(actor, res)');
    expect(admin).toContain("operation === 'rename'");
    expect(admin).toContain("operation === 'move'");
    expect(admin).toContain("operation === 'archive'");
    expect(admin).toContain("operation === 'merge'");
    expect(admin).toContain('merged_into_topic_id');
    expect(admin).toContain("'MERGE_CYCLE'");
    expect(admin).toContain('actor.sql.transaction([');
    expect(admin).toContain('logAudit(actor.sql');
    expect(review).toContain('ensureAdmin(actor, res)');
    expect(review).toContain("status = 'pending'");
    expect(review).toContain('logAudit(actor.sql');
  });

  test('topic, connection, contribution, and reply creation preserve their contracts', () => {
    const api = read('api/curriculum.js');
    const createTopic = functionBody(api, 'handleCreateTopic');
    const connect = functionBody(api, 'handleCreateConnection');
    const contribute = functionBody(api, 'handleCreateContribution');

    expect(createTopic).toContain('matches');
    expect(createTopic).toContain("'TOPIC_ALREADY_EXISTS'");
    expect(createTopic).toContain('parent_topic_id');
    expect(createTopic).toContain('INSERT INTO curriculum_topics');

    expect(connect).toContain('Math.min(topicId, relatedTopicId)');
    expect(connect).toContain('INSERT INTO curriculum_topic_connections');
    expect(connect).toContain('ON CONFLICT (school_id, left_topic_id, right_topic_id)');

    expect(contribute).toContain('parent_contribution_id');
    expect(contribute).toContain('response_type');
    expect(contribute).toContain('INSERT INTO curriculum_contributions');
    expect(contribute).toContain("responseType === 'connect_topic' && (!linkedTopicId || linkedTopicId === topicId)");
    expect(contribute).toContain("responseType !== 'connect_topic' && linkedTopicId");
    expect(contribute).toContain("responseType === 'connect_topic'");
    expect(contribute).toContain('INSERT INTO curriculum_topic_connections');
  });

  test('pages expose seven collapsible areas, draft protection, and portal navigation', () => {
    const landing = read('public/instructor/curriculum.html');
    const topicPage = read('public/instructor/curriculum-topic.html');
    const topicJs = read('public/instructor/curriculum-topic.js');
    const css = read('public/instructor/curriculum.css');
    const sidebar = read('public/sidebar.js');
    const admin = read('public/admin/portal.html');

    for (const html of [landing, topicPage]) {
      expect(html).toContain('/cookie-consent.js');
      expect(html).toContain('/posthog-loader.js');
      expect(html).toContain('/shared/branding.js');
      expect(html).toContain('/shared/curriculum-auth.js');
    }
    expect(sidebar).toContain("label: 'Curriculum'");
    expect(sidebar).toContain("href: '/instructor/curriculum.html'");
    expect(admin).toContain('<span class="nav-icon">CU</span> Curriculum');
    expect(topicJs).toContain("localStorage.setItem('cc_curriculum_last_topic_id'");
    expect(topicJs).toContain("'cc_curriculum_draft_'");
    expect(topicJs).toContain('prompts.forEach');
    expect(topicJs).toContain('curriculum-thread-replies');
    expect(topicJs).toContain('item.body');
    expect(css).toMatch(/\.curriculum-contribution-actions button \{\n  min-height: 44px;/);
    expect(css).toMatch(/\.curriculum-thread-replies > summary \{\n  display: inline-flex;\n  min-height: 44px;/);
    expect(topicJs).toContain("else if (event.key === 'Tab') trapSheetFocus(event)");
    expect(css).toContain('bottom: calc(78px + env(safe-area-inset-bottom');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('landing search, duplicate matching, and phone layout stay usable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(consentAndInstructorScript());
    await page.route('**/pwa.js', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    }));
    await page.route('**/api/curriculum?action=bootstrap', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bootstrapPayload)
    }));

    await page.goto('/instructor/curriculum.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Curriculum', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark-mode/);
    await expect(page.locator('#topicResults .curriculum-topic-row')).toHaveCount(4);

    await page.getByLabel('Find a topic').fill('clutch');
    await expect(page.locator('#topicResults .curriculum-topic-row')).toHaveCount(1);
    await expect(page.locator('#topicResults')).toContainText('Clutch control');

    await page.locator('.curriculum-mobile-add').click();
    await page.getByLabel('Topic name').fill('Clutch');
    await expect(page.locator('#topicMatches')).toContainText('Clutch control');
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: 'Close add topic' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#createTopicButton')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close add topic' })).toBeFocused();

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      addHeight: document.querySelector('.curriculum-mobile-add')?.getBoundingClientRect().height || 0,
      searchHeight: document.getElementById('topicSearch')?.getBoundingClientRect().height || 0,
      sheetRight: document.getElementById('topicSheet')?.getBoundingClientRect().right || 0
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.addHeight).toBeGreaterThanOrEqual(44);
    expect(layout.searchHeight).toBeGreaterThanOrEqual(44);
    expect(layout.sheetRight).toBeLessThanOrEqual(layout.viewport);

    await page.getByRole('button', { name: 'Close add topic' }).click();
    await expect(page.locator('.curriculum-mobile-add')).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.ccDarkMode.set('light'));
    await expect(page.locator('html')).toHaveClass(/light-mode/);
    await expect(page.locator('.curriculum-desktop-action')).toBeVisible();
    await expect(page.locator('.curriculum-mobile-add')).toBeHidden();
    const desktopLayout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      pageRight: document.querySelector('.curriculum-page')?.getBoundingClientRect().right || 0
    }));
    expect(desktopLayout.scrollWidth).toBeLessThanOrEqual(desktopLayout.viewport);
    expect(desktopLayout.pageRight).toBeLessThanOrEqual(desktopLayout.viewport);
  });

  test('topic workspace renders raw named threads safely and posts a reply', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(consentAndInstructorScript());
    await page.route('**/pwa.js', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    }));
    await page.route('**/api/curriculum?action=bootstrap', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bootstrapPayload)
    }));

    const topicPayload = {
      ok: true,
      actor: bootstrapPayload.actor,
      prompts: bootstrapPayload.prompts,
      topic: {
        id: 1,
        name: 'Controls',
        description: 'Explore how learners understand and use the vehicle controls.',
        parent_topic_id: null,
        parent_name: null,
        archived_at: null
      },
      subtopics: [{ id: 4, name: 'Clutch control', description: 'Finding the biting point.' }],
      connections: [{ id: 3, topic_id: 2, topic_name: 'Junctions', label: 'Applied together' }],
      contributions: [
        {
          id: 10,
          topic_id: 1,
          prompt_key: 'understand',
          parent_contribution_id: null,
          response_type: null,
          author_type: 'instructor',
          author_id: 8,
          author_name: 'Simon Green',
          body: '<img src=x onerror=window.__curriculumXss=true> Explain cause and effect.',
          created_at: '2026-07-30T09:00:00.000Z',
          edited_at: null,
          is_own: false
        },
        {
          id: 11,
          topic_id: 1,
          prompt_key: 'understand',
          parent_contribution_id: 10,
          response_type: 'example',
          author_type: 'instructor',
          author_id: 7,
          author_name: 'Fraser Carter',
          body: 'Use a quiet-road example.',
          created_at: '2026-07-30T09:20:00.000Z',
          edited_at: null,
          is_own: true
        }
      ]
    };

    await page.route('**/api/curriculum?action=topic&id=1', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(topicPayload)
    }));
    await page.route('**/api/curriculum?action=create-contribution', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toMatchObject({
        topic_id: 1,
        prompt_key: 'understand',
        parent_contribution_id: 10,
        response_type: 'build_on',
        body: 'Link the explanation to what the learner can feel.'
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          contribution: {
            id: 12,
            topic_id: 1,
            prompt_key: 'understand',
            parent_contribution_id: 10,
            response_type: 'build_on',
            author_name: 'Fraser Carter',
            body: 'Link the explanation to what the learner can feel.'
          }
        })
      });
    });

    await page.goto('/instructor/curriculum-topic?id=1', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Controls', exact: true })).toBeVisible();
    await expect(page.locator('.curriculum-area')).toHaveCount(7);
    await expect(page.getByRole('link', { name: 'Junctions' })).toHaveAttribute(
      'href',
      '/instructor/curriculum-topic?id=2'
    );
    await expect(page.getByRole('link', { name: 'Clutch control' })).toHaveAttribute(
      'href',
      '/instructor/curriculum-topic?id=4'
    );

    await page.locator('.curriculum-area').first().locator('summary').first().click();
    await expect(page.locator('.curriculum-contribution-text').first()).toHaveText(
      '<img src=x onerror=window.__curriculumXss=true> Explain cause and effect.'
    );
    await expect(page.locator('.curriculum-contribution-text img')).toHaveCount(0);
    await expect(page.evaluate(() => window.__curriculumXss)).resolves.toBeUndefined();
    await expect(page.getByText('1 reply', { exact: true })).toBeVisible();
    const threadTargets = await page.evaluate(() => ({
      replyHeight: document.querySelector('[data-action="reply"]')?.getBoundingClientRect().height || 0,
      threadSummaryHeight: document.querySelector('.curriculum-thread-replies > summary')?.getBoundingClientRect().height || 0
    }));
    expect(threadTargets.replyHeight).toBeGreaterThanOrEqual(44);
    expect(threadTargets.threadSummaryHeight).toBeGreaterThanOrEqual(44);

    await page.locator('[data-action="reply"][data-contribution-id="10"]').click();
    await page.getByLabel('What would you like to add?').fill(
      'Link the explanation to what the learner can feel.'
    );
    await page.getByRole('button', { name: 'Post response' }).click();
    await expect(page.locator('#curriculumStatus')).toContainText('Your response was added.');

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mobileInputHeight: document.getElementById('mobileAddInput')?.getBoundingClientRect().height || 0
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.mobileInputHeight).toBeGreaterThanOrEqual(44);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.curriculum-topic-actions')).toBeVisible();
    await expect(page.locator('#mobileAddInput')).toBeHidden();
    const desktopLayout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      workspaceRight: document.querySelector('.curriculum-workspace')?.getBoundingClientRect().right || 0
    }));
    expect(desktopLayout.scrollWidth).toBeLessThanOrEqual(desktopLayout.viewport);
    expect(desktopLayout.workspaceRight).toBeLessThanOrEqual(desktopLayout.viewport);
  });
});
