const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

test.describe('mock test supervisor notes persistence', () => {
  test('schema has a JSONB home for supervisor notes and hints', () => {
    const migration = read('db/migrations/031_mock_test_supervisor_notes.sql');
    const aggregate = read('db/migration.sql');

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS supervisor_notes JSONB NOT NULL DEFAULT');
    expect(migration).toContain("'{}'::jsonb");
    expect(aggregate).toContain("supervisor_notes       JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(aggregate).toContain("ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS supervisor_notes JSONB NOT NULL DEFAULT '{}'::jsonb");
  });

  test('learner completion sends sanitized supervisor note payload for persistence', () => {
    const source = read('public/learner/mock-test.js');

    expect(source).toContain('function buildSupervisorNotesPayload()');
    expect(source).toContain('selected_hints: selectedHints');
    expect(source).toContain('note: note');
    expect(source).toContain("if (testMode === 'supervisor')");
    expect(source).toContain('completePayload.supervisor_notes = buildSupervisorNotesPayload();');
  });

  test('learner API persists and returns supervisor notes in scoped mock-test reads', () => {
    const source = read('api/learner.js');

    expect(source).toContain('function sanitizeSupervisorNotesPayload(value)');
    expect(source).toContain('supervisor_notes = ${supervisorNotesJson}::jsonb');
    expect(source).toContain('SELECT id, completed_at, result, mode, supervisor_notes');
    expect(source).toContain('result, mode, notes, supervisor_notes');
    expect(source).toContain('WHERE mt.learner_id = ${user.id} AND mt.school_id = ${schoolId}');
  });

  test('instructor mock-test history can display saved supervisor notes', () => {
    const api = read('api/instructor.js');
    const ui = read('public/instructor/learners.js');

    expect(api).toContain('mt.supervisor_notes');
    expect(ui).toContain('function renderSupervisorNotes(value)');
    expect(ui).toContain("if (mt.mode === 'supervisor') html += renderSupervisorNotes(mt.supervisor_notes);");
    expect(ui).toContain('Supervisor notes');
    expect(ui).toContain('selected_hints');
  });
});
