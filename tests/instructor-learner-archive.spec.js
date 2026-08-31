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
  test('uses tenant-scoped audit events instead of the GDPR deletion state or a schema change', () => {
    const monolith = read('db/migration.sql');
    const api = read('api/instructor.js');

    expect(monolith).not.toContain('idx_instructor_learner_notes_archived');
    expect(api).toContain("FROM audit_log al");
    expect(api).toContain("al.target_type = 'learner_user'");
    expect(api).toContain("al.details->>'instructor_id' = ${String(instructor.id)}");
  });

  test('archive mutation is reversible, school scoped and audited', () => {
    const api = read('api/instructor.js');
    const body = asyncFunctionBody(api, 'handleSetLearnerArchived');

    expect(api).toContain("if (action === 'set-learner-archived') return handleSetLearnerArchived(req, res)");
    expect(body).toContain("if (typeof archived !== 'boolean')");
    expect(body).toContain('WHERE id = ${learnerId}');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('await logAuditRequired(sql');
    expect(body).toContain("'instructor.learner_archived'");
    expect(body).toContain("'instructor.learner_restored'");
    expect(body).not.toContain('UPDATE learner_users');
    expect(body).not.toContain('UPDATE instructor_learner_notes');
  });

  test('active learner lists and every instructor learner picker exclude archived relationships', () => {
    const api = read('api/instructor.js');
    const myLearners = asyncFunctionBody(api, 'handleMyLearners');
    const schoolLearners = asyncFunctionBody(api, 'handleSchoolLearners');
    const previewAudience = asyncFunctionBody(api, 'handlePreviewBroadcastAudience');
    const createBroadcast = asyncFunctionBody(api, 'handleCreateBroadcastOffer');

    expect(myLearners).toContain("req.query.include_archived");
    expect(myLearners).toContain('archive_state.archived_at');
    expect(myLearners).toContain('AND (${includeArchived} OR archive_state.archived_at IS NULL)');

    for (const body of [schoolLearners, previewAudience, createBroadcast]) {
      expect(body).toContain('FROM audit_log al');
      expect(body).toContain('al.school_id = ${schoolId}');
      expect(body).toContain("al.details->>'instructor_id' = ${String(instructor.id)}");
      expect(body).toContain("<> 'instructor.learner_archived'");
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
