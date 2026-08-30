const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function asyncFunctionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThan(-1);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not parse ${name}`);
}

test.describe('instructor learner archive', () => {
  test('uses a dedicated instructor relationship timestamp instead of the GDPR deletion state', () => {
    const migration = read('db/migrations/057_instructor_learner_archive.sql');
    const monolith = read('db/migration.sql');

    for (const source of [migration, monolith]) {
      expect(source).toContain('ALTER TABLE instructor_learner_notes');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ');
      expect(source).toContain('idx_instructor_learner_notes_archived');
    }
    expect(migration).not.toContain('ALTER TABLE learner_users');
  });

  test('archive mutation is reversible, school scoped and audited', () => {
    const api = read('api/instructor.js');
    const body = asyncFunctionBody(api, 'handleSetLearnerArchived');

    expect(api).toContain("if (action === 'set-learner-archived') return handleSetLearnerArchived(req, res)");
    expect(body).toContain("if (typeof archived !== 'boolean')");
    expect(body).toContain('WHERE id = ${learnerId}');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('INSERT INTO instructor_learner_notes');
    expect(body).toContain('DO UPDATE SET archived_at = NOW()');
    expect(body).toContain('SET archived_at = NULL');
    expect(body).toContain("'instructor.learner_archived'");
    expect(body).toContain("'instructor.learner_restored'");
    expect(body).not.toContain('UPDATE learner_users');
  });

  test('active learner lists and every instructor learner picker exclude archived relationships', () => {
    const api = read('api/instructor.js');
    const myLearners = asyncFunctionBody(api, 'handleMyLearners');
    const schoolLearners = asyncFunctionBody(api, 'handleSchoolLearners');
    const previewAudience = asyncFunctionBody(api, 'handlePreviewBroadcastAudience');
    const createBroadcast = asyncFunctionBody(api, 'handleCreateBroadcastOffer');

    expect(myLearners).toContain("req.query.include_archived");
    expect(myLearners).toContain('iln.archived_at::text AS archived_at');
    expect(myLearners).toContain('AND (${includeArchived} OR iln.archived_at IS NULL)');

    for (const body of [schoolLearners, previewAudience, createBroadcast]) {
      expect(body).toContain('FROM instructor_learner_notes archived_note');
      expect(body).toContain('archived_note.instructor_id = ${instructor.id}');
      expect(body).toContain('archived_note.school_id = ${schoolId}');
      expect(body).toContain('archived_note.archived_at IS NOT NULL');
    }
  });

  test('instructor UI can browse, archive and restore retained learners', () => {
    const html = read('public/instructor/learners.html');
    const js = read('public/instructor/learners.js');

    expect(html).toContain('data-archive-filter="active"');
    expect(html).toContain('data-archive-filter="archived"');
    expect(html).toContain('Archived</button>');
    expect(js).toContain("my-learners&include_archived=true");
    expect(js).toContain("currentArchiveFilter === 'archived'");
    expect(js).toContain("data-action=\"set-learner-archived\"");
    expect(js).toContain("/api/instructor?action=set-learner-archived");
    expect(js).toContain("archived ? 'Archive learner' : 'Restore learner'");
  });
});
