const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migration.sql'), 'utf8');
const refundNotesMigrationSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '027_refund_event_notes.sql'), 'utf8');
const gdprJs = fs.readFileSync(path.join(__dirname, '..', 'api', '_gdpr.js'), 'utf8');
const learnerJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'learner.js'), 'utf8');

test.describe('refund ledger schema', () => {
  test('adds refund event and line tables with tenant scope and FK indexes', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS refund_events');
    expect(migrationSql).toContain('school_id                           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
    expect(migrationSql).toContain("refund_type IN ('credit_purchase', 'repeat_offer_partial', 'direct_slot', 'direct_offer', 'manual_record')");
    expect(migrationSql).toContain("status IN ('previewed', 'manual_review', 'blocked', 'executed')");
    expect(migrationSql).toContain('gross_refund_pence                  INTEGER NOT NULL CHECK (gross_refund_pence >= 0)');
    expect(migrationSql).toContain('processing_fee_withheld_pence       INTEGER NOT NULL CHECK (processing_fee_withheld_pence >= 0)');
    expect(migrationSql).toContain('net_refund_pence                    INTEGER NOT NULL CHECK (net_refund_pence >= 0)');
    expect(migrationSql).toContain('CHECK (processing_fee_withheld_pence <= gross_refund_pence)');
    expect(migrationSql).toContain('CHECK (net_refund_pence = gross_refund_pence - processing_fee_withheld_pence)');
    expect(migrationSql).toContain("metadata                            JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_events_school ON refund_events(school_id)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_events_learner ON refund_events(learner_id)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_events_created_by ON refund_events(created_by)');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_idempotency_key');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_id_school');
    expect(migrationSql).toContain("IF to_regclass('public.refund_events') IS NOT NULL THEN");
    expect(migrationSql).toContain("ALTER TABLE refund_events DROP CONSTRAINT");
    expect(migrationSql).toContain('ADD CONSTRAINT refund_events_status_check');
    expect(migrationSql).toContain("CHECK (status IN ('previewed', 'manual_review', 'blocked', 'executed'))");

    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS refund_event_lines');
    expect(migrationSql).toContain('school_id                           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
    expect(migrationSql).toContain('refund_event_id                     INTEGER NOT NULL REFERENCES refund_events(id)');
    expect(migrationSql).toContain('credit_transaction_id               INTEGER REFERENCES credit_transactions(id)');
    expect(migrationSql).toContain('booking_credit_source_id            INTEGER REFERENCES booking_credit_sources(id)');
    expect(migrationSql).toContain('lesson_booking_id                   INTEGER REFERENCES lesson_bookings(id)');
    expect(migrationSql).toContain('credit_source_adjustment_id         INTEGER REFERENCES credit_source_adjustments(id)');
    expect(migrationSql).toContain('gross_pence_removed                 INTEGER NOT NULL CHECK (gross_pence_removed >= 0)');
    expect(migrationSql).toContain('source_fee_pence_used               INTEGER NOT NULL CHECK (source_fee_pence_used >= 0)');
    expect(migrationSql).toContain('fee_withheld_pence                  INTEGER NOT NULL CHECK (fee_withheld_pence >= 0)');
    expect(migrationSql).toContain('net_refund_pence                    INTEGER NOT NULL CHECK (net_refund_pence >= 0)');
    expect(migrationSql).toContain('minutes_adjusted                    INTEGER NOT NULL DEFAULT 0 CHECK (minutes_adjusted >= 0)');
    expect(migrationSql).toContain('CHECK (fee_withheld_pence <= gross_pence_removed)');
    expect(migrationSql).toContain('CHECK (net_refund_pence = gross_pence_removed - fee_withheld_pence)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_lines_event ON refund_event_lines(refund_event_id)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_lines_credit_tx ON refund_event_lines(credit_transaction_id)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_lines_bcs ON refund_event_lines(booking_credit_source_id)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_lines_booking ON refund_event_lines(lesson_booking_id)');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_lines_csa ON refund_event_lines(credit_source_adjustment_id)');

    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS refund_event_notes');
    expect(migrationSql).toContain('refund_event_id                     INTEGER NOT NULL');
    expect(migrationSql).toContain('CONSTRAINT refund_event_notes_event_school_fk');
    expect(migrationSql).toContain('FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id)');
    expect(migrationSql).toContain("note_type IN ('operator_note', 'evidence', 'incident', 'repair_decision')");
    expect(migrationSql).toContain("incident_status IN ('open', 'watching', 'resolved', 'not_applicable')");
    expect(migrationSql).toContain("CHECK (note_type = 'incident' OR incident_status = 'not_applicable')");
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_notes_school');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_notes_event');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_refund_event_notes_incident');
    expect(refundNotesMigrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_events_id_school');
    expect(refundNotesMigrationSql).toContain('CONSTRAINT refund_event_notes_event_school_fk');
    expect(refundNotesMigrationSql).toContain('FOREIGN KEY (refund_event_id, school_id) REFERENCES refund_events(id, school_id)');
  });

  test('wires refund_events into GDPR export and learner deletion anonymisation', () => {
    expect(learnerJs).toContain('FROM refund_events');
    expect(learnerJs).toContain('refund_events: refundEvents');
    expect(learnerJs).toContain('refundLedgerTablesExist(sql)');
    expect(gdprJs).toContain('async function refundLedgerTablesExist(sql)');
    expect(gdprJs).toContain("table_name = 'refund_events'");
    expect(gdprJs).toContain("table_name = 'refund_event_lines'");
    expect(gdprJs).toContain('UPDATE refund_events SET learner_id = NULL WHERE learner_id = ${learnerId}');
  });
});
