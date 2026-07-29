// @ts-check
// Static contracts for the shared, tenant-scoped instructor notes board.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test.describe('instructor notes board', () => {
  test.describe.configure({ mode: 'serial' });

  test('migration creates a constrained, tenant-owned notes table with FK indexes', () => {
    const migration = read('db/migration.sql');
    const step = read('db/migrations/037_instructor_notes.sql');

    for (const source of [migration, step]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS instructor_notes');
      expect(source).toContain('school_id     INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
      expect(source).toContain('FOREIGN KEY (instructor_id, school_id)');
      expect(source).toContain('REFERENCES instructors(id, school_id) ON DELETE CASCADE');
      expect(source).toContain('CHECK (char_length(BTRIM(content)) BETWEEN 1 AND 2000)');
      expect(source).toContain('idx_instructor_notes_school_feed');
      expect(source).toContain('ON instructor_notes(school_id, created_at DESC, id DESC)');
      expect(source).toContain('idx_instructor_notes_instructor');
      expect(source).toContain('ON instructor_notes(instructor_id, school_id)');
    }

    expect(step).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school');
    expect(migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_instructors_id_school'))
      .toBeLessThan(migration.indexOf('CREATE TABLE IF NOT EXISTS instructor_notes'));
  });

  test('API lists and creates notes only inside the authenticated school', () => {
    const api = read('api/instructor.js');

    expect(api).toContain("action === 'list-notes'");
    expect(api).toContain("action === 'create-note'");
    expect(api).toContain('async function handleListNotes');
    expect(api).toContain('async function handleCreateNote');
    expect(api).toContain("if (req.method !== 'GET')");
    expect(api).toContain("if (req.method !== 'POST')");
    expect(api).toContain('const auth = verifyInstructorAuth(req)');
    expect(api).toContain('const schoolId = auth.school_id || 1');
    expect(api).toContain('WHERE n.school_id = ${schoolId}');
    expect(api).toContain('AND i.school_id = n.school_id');
    expect(api).toContain('INSERT INTO instructor_notes (school_id, instructor_id, content)');
    expect(api).toContain('SELECT ${schoolId}, i.id, ${content}');
    expect(api).toContain('AND i.school_id = ${schoolId}');
    expect(api).toContain('const contentLength = Array.from(content).length');
    expect(api).toContain('contentLength > 2000');
    expect(api).not.toContain('req.query.school_id');
  });

  test('page exposes an accessible composer and newest-first feed from the instructor sidebar', () => {
    const html = read('public/instructor/notes.html');
    const css = read('public/instructor/notes.css');
    const sidebar = read('public/sidebar.js');

    expect(sidebar).toContain("{ icon: 'fileText', label: 'Notes', href: '/instructor/notes.html' }");
    expect(html).toContain('<label for="noteContent">');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain('id="noteError" role="alert"');
    expect(html).toContain('id="noteFormStatus" aria-live="polite"');
    expect(html).toContain('id="notesFeed"');
    expect(html).toContain('/cookie-consent.js');
    expect(html).toContain('/posthog-loader.js');
    expect(html).toContain('/shared/branding.js');
    expect(html).toContain('/sidebar.js');
    expect(html).toContain('/shared/instructor-auth.js');

    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('white-space: pre-wrap');
    expect(css).toContain('overflow-wrap: anywhere');
  });

  test('client uses authenticated requests and renders every user-controlled field as text', () => {
    const js = read('public/instructor/notes.js');

    expect(js).toContain("window.ccAuth.fetchAuthed('/api/instructor?action=list-notes')");
    expect(js).toContain("window.ccAuth.fetchAuthed('/api/instructor?action=create-note'");
    expect(js).toContain("method: 'POST'");
    expect(js).toContain('body: JSON.stringify({ content: content })');
    expect(js).toContain('author.textContent = note.author_name');
    expect(js).toContain('content.textContent = note.content');
    expect(js).toContain('feed.prepend(createNoteCard(data.note))');
    expect(js).not.toContain('content.innerHTML = note.content');
    expect(js).not.toContain('author.innerHTML = note.author_name');
  });

  test('instructor can read and post notes without user content becoming HTML', async ({ page }) => {
    await page.route('**/pwa.js', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    }));
    await page.addInitScript(() => {
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
        timestamp: '2026-07-29T09:00:00.000Z'
      }));
    });

    await page.route('**/api/instructor?action=list-notes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          notes: [{
            id: 11,
            content: '<img src=x onerror=window.__noteXss=true> Check tyre pressures weekly.',
            created_at: '2026-07-29T09:30:00.000Z',
            author_id: 8,
            author_name: 'Simon Green',
            is_current_instructor: false
          }]
        })
      });
    });

    await page.route('**/api/instructor?action=create-note', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ content: 'Try a shared lesson-plan template.' });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          note: {
            id: 12,
            content: 'Try a shared lesson-plan template.',
            created_at: '2026-07-29T10:00:00.000Z',
            author_id: 7,
            author_name: 'Fraser Carter',
            is_current_instructor: true
          }
        })
      });
    });

    await page.goto('/instructor/notes', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Instructor notes' })).toBeVisible();
    await expect(page.locator('.note-content')).toHaveText(
      '<img src=x onerror=window.__noteXss=true> Check tyre pressures weekly.'
    );
    await expect(page.locator('.note-content img')).toHaveCount(0);
    await expect(page.evaluate(() => window.__noteXss)).resolves.toBeUndefined();

    await page.getByLabel('What would you like to share?').fill('Try a shared lesson-plan template.');
    await page.getByRole('button', { name: 'Post note' }).click();

    await expect(page.locator('.note-card').first()).toContainText('Try a shared lesson-plan template.');
    await expect(page.locator('.note-card').first()).toContainText('You');
    await expect(page.locator('#notesCount')).toHaveText('2 notes');
    await expect(page.locator('#noteFormStatus')).toHaveText('Your note has been posted.');
  });

  test('phone and landscape layouts stay usable in dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/pwa.js', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    }));
    await page.addInitScript(() => {
      localStorage.setItem('cc_instructor', JSON.stringify({
        instructor: { id: 7, name: 'Fraser Carter', email: 'fraser@example.com', school_id: 1 }
      }));
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false,
        version: 1,
        timestamp: '2026-07-29T09:00:00.000Z'
      }));
      localStorage.setItem('cc_dark_mode', 'dark');
    });
    await page.route('**/api/instructor?action=list-notes', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, notes: [] })
    }));

    await page.goto('/instructor/notes', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('No notes yet')).toBeVisible();
    var phoneLayout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      submitHeight: document.getElementById('noteSubmit')?.getBoundingClientRect().height || 0,
      composerRight: document.querySelector('.notes-composer')?.getBoundingClientRect().right || 0,
      dark: document.documentElement.classList.contains('dark-mode')
    }));
    expect(phoneLayout.dark).toBe(true);
    expect(phoneLayout.scrollWidth).toBeLessThanOrEqual(phoneLayout.viewport);
    expect(phoneLayout.submitHeight).toBeGreaterThanOrEqual(44);
    expect(phoneLayout.composerRight).toBeLessThanOrEqual(phoneLayout.viewport);

    await page.setViewportSize({ width: 812, height: 375 });
    var landscapeLayout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      composerRight: document.querySelector('.notes-composer')?.getBoundingClientRect().right || 0
    }));
    expect(landscapeLayout.scrollWidth).toBeLessThanOrEqual(landscapeLayout.viewport);
    expect(landscapeLayout.composerRight).toBeLessThanOrEqual(landscapeLayout.viewport);
  });
});
