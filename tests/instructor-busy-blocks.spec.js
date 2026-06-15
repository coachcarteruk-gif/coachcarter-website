// @ts-check
// Static contract tests for instructor-created timed busy blocks.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('instructor busy blocks', () => {
  test('migration creates tenant-scoped timed busy-block table', () => {
    const sql = read('db/migration.sql');
    const step = read('db/migrations/029_instructor_busy_blocks.sql');

    for (const source of [sql, step]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS instructor_busy_blocks');
      expect(source).toContain('instructor_id   INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE');
      expect(source).toContain('school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
      expect(source).toContain('block_date      DATE NOT NULL');
      expect(source).toContain('CHECK (start_time < end_time)');
      expect(source).toContain('uq_instructor_busy_block_slot');
      expect(source).toContain('idx_instructor_busy_blocks_lookup');
    }
  });

  test('instructor API exposes list, create, and delete actions scoped by instructor and school', () => {
    const js = read('api/instructor.js');

    expect(js).toContain("action === 'busy-blocks'");
    expect(js).toContain("action === 'create-busy-block'");
    expect(js).toContain("action === 'delete-busy-block'");
    expect(js).toContain('FROM instructor_busy_blocks');
    expect(js).toContain('WHERE instructor_id = ${instructor.id}');
    expect(js).toContain('AND school_id = ${schoolId}');
    expect(js).toContain('block_date = ${block_date}::date');
    expect(js).toContain('Busy block overlaps an existing lesson');
    expect(js).toContain('DELETE FROM instructor_busy_blocks');
    expect(js).toContain('busy_blocks: busyBlocks');
  });

  test('slot engine blocks learner availability, durations, recurring holds, and reschedules', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('FROM instructor_busy_blocks');
    expect(slots).toContain('busyBlocks.some(b => slotStart < timeToMinutes(b.end_time)');
    expect(slots).toContain('bookedIndex[key].push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time), postcode: null })');
    expect(slots).toContain("busyBlocks.forEach(row => add(row.date, 'busy_block'))");
    expect(slots).toContain('busyBlockConflictRows');
    expect(slots).toContain("code: 'SLOT_BLOCKED_BY_BUSY_BLOCK'");
    expect(slots).toContain('That slot is no longer available. Please choose another.');
  });

  test('instructor calendar can create, render, and remove busy blocks', () => {
    const html = read('public/instructor/index.html');
    const js = read('public/instructor/index.js');

    expect(html).toContain('id="btn-open-busy"');
    expect(html).toContain('id="busyModal"');
    expect(html).toContain('id="busyDate"');
    expect(html).toContain('id="busyNote"');
    expect(js).toContain('busyBlockCache = {}');
    expect(js).toContain("create-busy-block");
    expect(js).toContain("delete-busy-block");
    expect(js).toContain("data-action=\"delete-busy-block\"");
    expect(js).toContain("open-busy-modal");
    expect(js).toContain("showToast('Busy time blocked'");
  });
});
