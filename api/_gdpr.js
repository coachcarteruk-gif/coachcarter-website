// Shared GDPR helpers.
//
// deleteLearnerCascade(sql, learnerId, opts) — the one cascade list used by
// every learner-deletion path. Three call sites used to maintain their own
// divergent lists:
//
//   - api/learner.js handleConfirmDeletion        (learner self-delete)
//   - api/admin.js handleDeleteLearner            (admin portal)
//   - api/cron-retention.js                       (90-day post-archive sweep)
//
// They drifted: the admin path only deleted ~4 tables explicitly and relied on
// ON DELETE CASCADE FKs for the rest. Self-delete and retention enumerated 17
// tables. All three hard-deleted `lesson_bookings`, which violates the 7-year
// retention rule on financial records (CLAUDE.md GDPR rule 7).
//
// Behaviour:
//   1. Anonymise `credit_transactions` (learner_id = NULL, anonymized = true)
//   2. Anonymise `lesson_bookings` (learner_id = NULL, learner_anonymized = true).
//   3. Nullify refund_events.learner_id and package_purchase_attempts.learner_id
//      when those retained financial-ledger tables exist.
//      The migration drops the old ON DELETE CASCADE FK on
//      lesson_bookings.learner_id and replaces it with ON DELETE SET NULL —
//      belt-and-braces with the explicit UPDATE here.
//   3. Hard-delete everything else FK-referencing learner_users that is not a
//      financial record.
//   4. Nullify cookie_consents.learner_id (consent record is anonymous after
//      delete).
//   5. Delete the learner_users row.
//
// All wrapped in `sql.transaction([...])` — Neon HTTP driver's non-interactive
// transaction. Atomic: either every step lands or none do. The prior pattern
// (per-DELETE try/catch swallowing every error to console.warn) hid real
// failures and left orphan state across half-completed deletions.
//
// Note on lesson_bookings child tables: `sent_reminders` and
// `lesson_confirmations` reference the booking, not the learner. Because we
// retain the booking row (just anonymise the learner_id), we also retain those
// children. They contain no personal data on their own — sent_reminders is
// "we sent reminder X for booking Y at time Z", lesson_confirmations is
// "instructor/learner confirmed lesson happened with these notes". After
// anonymisation, the booking has no learner attached, so these become
// unattributable too.
//
// Opts:
//   - email          (optional) — used to scope magic_link_tokens cleanup
//   - lookupEmail    (bool, default true) — if email not provided, SELECT it
//                    from learner_users before the transaction
//
// Returns { ok: true, learnerId, email }.

async function refundLedgerTablesExist(sql) {
  const [row] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'refund_events'
      ) AS has_refund_events,
      EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'refund_event_lines'
      ) AS has_refund_event_lines
  `;
  return Boolean(row?.has_refund_events && row?.has_refund_event_lines);
}

async function learnerBroadcastTablesExist(sql) {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'learner_broadcast_recipients'
    ) AS has_learner_broadcast_recipients
  `;
  return Boolean(row?.has_learner_broadcast_recipients);
}

async function packagePurchaseAttemptsTableExists(sql) {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'package_purchase_attempts'
    ) AS has_package_purchase_attempts
  `;
  return Boolean(row?.has_package_purchase_attempts);
}

async function fullCurriculumTablesExist(sql) {
  const [row] = await sql`
    SELECT
      to_regclass('public.learner_package_purchases') IS NOT NULL AS has_purchases,
      to_regclass('public.full_curriculum_enrolments') IS NOT NULL AS has_enrolments,
      to_regclass('public.full_curriculum_test_bookings') IS NOT NULL AS has_test_bookings
  `;
  return Boolean(row?.has_purchases && row?.has_enrolments && row?.has_test_bookings);
}

async function fullCurriculumMatchingTablesExist(sql) {
  const [row] = await sql`
    SELECT
      to_regclass('public.full_curriculum_matching_records') IS NOT NULL AS has_matching,
      to_regclass('public.full_curriculum_assignment_events') IS NOT NULL AS has_assignments,
      to_regclass('public.full_curriculum_availability_versions') IS NOT NULL AS has_availability,
      to_regclass('public.full_curriculum_availability_windows') IS NOT NULL AS has_windows
  `;
  return Boolean(row?.has_matching && row?.has_assignments && row?.has_availability && row?.has_windows);
}

async function fullCurriculumConsumerRightsTablesExist(sql) {
  const [row] = await sql`
    SELECT
      to_regclass('public.full_curriculum_consumer_contract_evidence') IS NOT NULL AS has_contract_evidence,
      to_regclass('public.full_curriculum_termination_requests') IS NOT NULL AS has_termination_requests,
      to_regclass('public.full_curriculum_refund_cases') IS NOT NULL AS has_refund_cases
  `;
  return Boolean(row?.has_contract_evidence && row?.has_termination_requests && row?.has_refund_cases);
}

async function fullCurriculumPilotAccessTableExists(sql) {
  const [row] = await sql`
    SELECT to_regclass('public.full_curriculum_pilot_access') IS NOT NULL AS has_pilot_access
  `;
  return Boolean(row?.has_pilot_access);
}

async function deleteLearnerCascade(sql, learnerId, opts = {}) {
  if (!sql || !learnerId) {
    throw new Error('deleteLearnerCascade: sql and learnerId required');
  }

  // Look up email if not provided. Needed for magic_link_tokens cleanup, which
  // keys on email rather than learner_id (tokens predate the learner_users row
  // for pre-signup magic links).
  let email = opts.email;
  if (!email && opts.lookupEmail !== false) {
    const [row] = await sql`SELECT email FROM learner_users WHERE id = ${learnerId}`;
    email = row?.email || null;
  }

  const hasRefundLedger = await refundLedgerTablesExist(sql);
  const hasLearnerBroadcasts = await learnerBroadcastTablesExist(sql);
  const hasPackagePurchaseAttempts = await packagePurchaseAttemptsTableExists(sql);
  const hasFullCurriculum = await fullCurriculumTablesExist(sql);
  const hasFullCurriculumMatching = await fullCurriculumMatchingTablesExist(sql);
  const hasFullCurriculumConsumerRights = await fullCurriculumConsumerRightsTablesExist(sql);
  const hasFullCurriculumPilotAccess = await fullCurriculumPilotAccessTableExists(sql);

  const txn = [
    // 1. Anonymise financial records (7-year retention).
    sql`UPDATE credit_transactions SET learner_id = NULL, anonymized = true WHERE learner_id = ${learnerId}`,
    sql`UPDATE lesson_bookings SET learner_id = NULL, learner_anonymized = true WHERE learner_id = ${learnerId}`,
    // Lesson requests: keep the row (it documents a payment hold/decision) but
    // strip all PII. The FK is ON DELETE SET NULL — this explicit UPDATE also
    // clears the guest contact columns and pickup address. A still-pending
    // request's hold release degrades safely: the card PI cancel needs no
    // learner row, and a credit hold refund is moot once the balance is gone.
    sql`UPDATE lesson_requests SET learner_id = NULL, guest_name = NULL, guest_email = NULL, guest_phone = NULL, pickup_address = NULL WHERE learner_id = ${learnerId}`,

    // 2. Hard-delete learner-keyed tables.
    sql`DELETE FROM skill_ratings WHERE user_id = ${learnerId}`,
    sql`DELETE FROM driving_sessions WHERE user_id = ${learnerId}`,
    sql`DELETE FROM quiz_results WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM mock_test_faults WHERE mock_test_id IN (SELECT id FROM mock_tests WHERE learner_id = ${learnerId})`,
    sql`DELETE FROM mock_tests WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM focused_practice_sessions WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM slot_reservations WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM learner_onboarding WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM learner_feedback WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM test_swap_requests WHERE requester_learner_id = ${learnerId}`,
    sql`DELETE FROM test_swap_listings WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM instructor_learner_notes WHERE learner_id = ${learnerId}`,
    sql`DELETE FROM learner_availability WHERE learner_id = ${learnerId}`,
    // Per-instructor credit balances (Step 2c). Hard-delete: the balance ledger
    // is per-learner state, not a financial record — credit_transactions and
    // booking_credit_sources carry the 7-year-retained money facts. Deleting
    // LCB rows BEFORE the parent learner is required because the FK is
    // ON DELETE CASCADE and the (planned, Step 4) sync trigger would otherwise
    // fire against a half-deleted learner. The trigger has a GDPR no-op guard
    // for belt-and-braces but explicit deletion here is the cleaner contract.
    sql`DELETE FROM learner_credit_balances WHERE learner_id = ${learnerId}`,
    sql`UPDATE learner_users SET referred_by = NULL WHERE referred_by = ${learnerId}`,
    sql`DELETE FROM referrals WHERE learner_id = ${learnerId}`,
    // deletion_requests.learner_id is NOT NULL with no ON DELETE clause, so we
    // must clear it before the parent learner_users row is deleted. Hard-delete
    // is fine — the row is short-lived audit metadata. Call sites that need an
    // audit record of the cascade running should use api/_audit.js (audit_log
    // table) instead.
    sql`DELETE FROM deletion_requests WHERE learner_id = ${learnerId}`,

    // 3. Nullify cookie consents (consent record stays as anonymous audit row).
    sql`UPDATE cookie_consents SET learner_id = NULL WHERE learner_id = ${learnerId}`,
  ];

  const retainedAnonymisation = [];
  if (hasRefundLedger) {
    retainedAnonymisation.push(sql`UPDATE refund_events SET learner_id = NULL WHERE learner_id = ${learnerId}`);
  }
  if (hasFullCurriculum) {
    retainedAnonymisation.push(
      ...(hasFullCurriculumConsumerRights
        ? [
            sql`UPDATE full_curriculum_refund_cases SET learner_id = NULL WHERE learner_id = ${learnerId}`,
            sql`UPDATE full_curriculum_termination_requests
                   SET learner_id = NULL,
                       actor_id = CASE WHEN actor_type = 'learner' THEN NULL ELSE actor_id END
                 WHERE learner_id = ${learnerId}`,
            sql`UPDATE full_curriculum_consumer_contract_evidence
                   SET learner_id = NULL,
                       actor_id = CASE WHEN actor_type = 'learner' THEN NULL ELSE actor_id END
                 WHERE learner_id = ${learnerId}`,
          ]
        : []),
      sql`UPDATE learner_package_purchases SET learner_id = NULL WHERE learner_id = ${learnerId}`,
      ...(hasFullCurriculumMatching
        ? [sql`UPDATE full_curriculum_matching_records
                  SET learner_id = NULL
                WHERE learner_id = ${learnerId}
                  AND school_id = (SELECT school_id FROM learner_users WHERE id = ${learnerId})`]
        : []),
      sql`UPDATE full_curriculum_enrolments SET learner_id = NULL WHERE learner_id = ${learnerId}`
    );
  }
  // The attempt FK contains the learner identity of its referenced test booking,
  // so the referencing attempt must be anonymised before that test-booking row.
  if (hasPackagePurchaseAttempts) {
    retainedAnonymisation.push(sql`UPDATE package_purchase_attempts SET learner_id = NULL WHERE learner_id = ${learnerId}`);
  }
  if (hasFullCurriculum) {
    retainedAnonymisation.push(
      sql`UPDATE full_curriculum_test_bookings SET learner_id = NULL, test_centre = NULL WHERE learner_id = ${learnerId}`
    );
  }
  if (hasLearnerBroadcasts) {
    retainedAnonymisation.push(sql`
      UPDATE learner_broadcast_recipients
         SET learner_id = NULL,
             learner_name = NULL,
             learner_email = NULL,
             phone = NULL
       WHERE learner_id = ${learnerId}
    `);
  }
  txn.splice(2, 0, ...retainedAnonymisation);

  if (hasFullCurriculumPilotAccess) {
    txn.push(sql`DELETE FROM full_curriculum_pilot_access WHERE learner_id = ${learnerId}`);
  }

  // Magic-link tokens key on email, not learner_id. Append conditionally.
  if (email) {
    txn.push(sql`DELETE FROM magic_link_tokens WHERE email = ${email}`);
  }

  // 4. Finally, the learner row itself. Must be last — earlier FK references
  //    (skill_ratings.user_id, slot_reservations.learner_id, etc.) would
  //    block this DELETE if their rows still existed.
  txn.push(sql`DELETE FROM learner_users WHERE id = ${learnerId}`);

  await sql.transaction(txn);

  return { ok: true, learnerId, email };
}

module.exports = {
  deleteLearnerCascade,
  refundLedgerTablesExist,
  learnerBroadcastTablesExist,
  packagePurchaseAttemptsTableExists,
  fullCurriculumTablesExist,
  fullCurriculumMatchingTablesExist,
  fullCurriculumConsumerRightsTablesExist,
  fullCurriculumPilotAccessTableExists,
};
