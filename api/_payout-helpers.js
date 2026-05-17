/**
 * Shared payout logic used by cron-payouts.js and admin manual trigger.
 *
 * Eligible bookings: status = 'chargeable'. The 1-hour buffer on the
 * scheduled → chargeable flip (see api/cron-auto-complete.js) absorbs clock
 * skew and last-minute reschedule races, so no extra grace period is needed.
 * Safety: UNIQUE(booking_id) on payout_line_items prevents double-payment.
 */
const { CHARGEABLE } = require('./_booking-status');
const { sendAlertEmail } = require('./_error-alert');

/**
 * Trigger A — widget-falsifiability alert. After a Stripe transfer fails for a
 * payout, look back at the last 24h of platform_balance_snapshots. If the most
 * recent one reported status='green', the widget was lying about Friday-payout
 * safety. Email Fraser so the dashboard's trust isn't silently eroded.
 *
 * Fire-and-forget — must not throw out of the failure path.
 */
async function alertIfWidgetLied(sql, { payout, instructor, error }) {
  try {
    const [snap] = await sql`
      SELECT id, captured_at, status, balance_after_payout_pence, total_payout_pence
        FROM platform_balance_snapshots
       WHERE captured_at > NOW() - INTERVAL '24 hours'
         AND status = 'green'
       ORDER BY captured_at DESC
       LIMIT 1
    `;
    if (!snap) return;

    const fmt = p => `£${(p/100).toFixed(2)}`;
    const txt = [
      `A Stripe transfer for payout #${payout.id} just failed, but the most recent`,
      `daily snapshot (within the last 24h) reported status='green'. The`,
      `Next Payout Preview widget is lying.`,
      ``,
      `Payout:`,
      `  id              ${payout.id}`,
      `  instructor      ${instructor.name} (id=${instructor.id}, ${instructor.email || 'no email'})`,
      `  Stripe error    ${error && error.message ? error.message : String(error)}`,
      ``,
      `Most recent green snapshot:`,
      `  snapshot id     ${snap.id}`,
      `  captured        ${new Date(snap.captured_at).toISOString()}`,
      `  status          ${snap.status}`,
      `  balance_after_payout_pence  ${fmt(snap.balance_after_payout_pence)}`,
      `  total_payout_pence          ${fmt(snap.total_payout_pence)}`,
    ].join('\n');
    const html = `
      <h3 style="color:#dc2626;">🚨 Payout failed despite green widget</h3>
      <p>A Stripe transfer for payout <code>#${payout.id}</code> just failed, but the most
         recent platform_balance_snapshot (within the last 24h) reported
         <code>status='green'</code>. The Next Payout Preview widget is lying.</p>
      <h4>Payout</h4>
      <ul>
        <li><b>id:</b> ${payout.id}</li>
        <li><b>instructor:</b> ${instructor.name} (id=${instructor.id})</li>
        <li><b>email:</b> ${instructor.email || '(none)'}</li>
        <li><b>Stripe error:</b> <code>${error && error.message ? error.message : String(error)}</code></li>
      </ul>
      <h4>Most recent green snapshot</h4>
      <ul>
        <li><b>snapshot id:</b> ${snap.id}</li>
        <li><b>captured:</b> ${new Date(snap.captured_at).toISOString()}</li>
        <li><b>status:</b> ${snap.status}</li>
        <li><b>balance_after_payout:</b> ${fmt(snap.balance_after_payout_pence)}</li>
        <li><b>total_payout:</b> ${fmt(snap.total_payout_pence)}</li>
      </ul>
    `;
    sendAlertEmail({
      subject: `🚨 Payout #${payout.id} failed despite green widget — ${instructor.name}`,
      text: txt,
      html
    });
  } catch (_) {
    // Best-effort. Never let alert plumbing break the cron's failure handling.
  }
}

/**
 * Get unpaid eligible bookings for an instructor.
 * `payoutsStartDate` is a date floor — bookings before it are excluded. NULL/undefined = no floor.
 * Test-account bookings (learner_users.is_test_account = TRUE) are excluded — they
 * are dev/QA noise, not real revenue, and must never trigger an instructor payout.
 */
async function getEligibleBookings(sql, instructorId, payoutsStartDate = null) {
  return sql`
    SELECT lb.id AS booking_id,
           lb.scheduled_date,
           lb.start_time,
           lb.end_time,
           lb.status,
           CASE WHEN iln.custom_hourly_rate_pence IS NOT NULL
             THEN ROUND(iln.custom_hourly_rate_pence * COALESCE(lt.duration_minutes, 90) / 60.0)
             ELSE COALESCE(lt.price_pence, 8250)
           END AS price_pence,
           COALESCE(lb.stripe_fee_pence, 0) AS stripe_fee_pence,
           COALESCE(lt.duration_minutes, 90) AS duration_minutes,
           COALESCE(lt.name, 'Standard Lesson') AS lesson_type_name
      FROM lesson_bookings lb
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN instructor_learner_notes iln ON iln.instructor_id = lb.instructor_id AND iln.learner_id = lb.learner_id
      LEFT JOIN payout_line_items pli ON pli.booking_id = lb.id
     WHERE lb.instructor_id = ${instructorId}
       AND pli.id IS NULL
       AND (${payoutsStartDate}::date IS NULL OR lb.scheduled_date >= ${payoutsStartDate}::date)
       AND lb.status = ${CHARGEABLE}
       AND COALESCE(lu.is_test_account, FALSE) = FALSE
     ORDER BY lb.scheduled_date ASC
  `;
}

/**
 * Process payout for a single instructor. Returns payout summary or null if nothing to pay.
 */
async function processPayoutForInstructor(sql, stripe, instructor) {
  const bookings = await getEligibleBookings(sql, instructor.id, instructor.payouts_start_date || null);
  if (!bookings.length) return null;

  const franchiseFee = instructor.weekly_franchise_fee_pence != null
    ? parseInt(instructor.weekly_franchise_fee_pence) : null;
  const commissionRate = parseFloat(instructor.commission_rate) || 0.85;

  let totalGrossPence = 0;
  let totalStripeFeesPence = 0;
  for (const b of bookings) {
    totalGrossPence += parseInt(b.price_pence);
    totalStripeFeesPence += parseInt(b.stripe_fee_pence || 0);
  }

  // Step 4f.d — Stripe fees come off totalGross BEFORE the franchise math runs.
  // They are a pass-through cost, never enter the shortfall ledger.
  // For franchise model: deductions math uses netOfStripeGross.
  // For commission model: commission × gross, then subtract Stripe fees separately
  // (per locked-in Decision 1 — commission on gross, not net).
  const netOfStripeGross = totalGrossPence - totalStripeFeesPence;

  let totalInstructorPence;
  let actualFranchiseFee = null;
  // Plan items 1.3 + 2.10 — only apply to franchise-model instructors.
  let shortfallThisWeek = 0;
  let depositDeducted = 0;
  let priorShortfallPence = 0;
  let priorShortfallId = null;
  let shortfallRecoveryId = null;

  if (franchiseFee != null) {
    // Read prior unrecovered shortfall (full-or-nothing recovery; partial deferred).
    // Only consider completed payouts — failed/processing rows must not be treated as settled debts.
    const priorRows = await sql`
      SELECT id, shortfall_pence
        FROM instructor_payouts
       WHERE instructor_id = ${instructor.id}
         AND status = 'completed'
         AND shortfall_pence > 0
         AND shortfall_recovered_from_payout_id IS NULL
       ORDER BY period_end DESC
       LIMIT 1
    `;
    if (priorRows.length) {
      priorShortfallPence = parseInt(priorRows[0].shortfall_pence);
      priorShortfallId = priorRows[0].id;
    }

    // Week-1 deposit eligibility: no prior completed payout AND Full Franchise.
    // Heuristic on weekly_franchise_fee_pence === 19500 until Phase 1 ships franchise_tier_id (FRANCHISE-MODEL-PLAN).
    const priorCompleted = await sql`
      SELECT 1 FROM instructor_payouts
       WHERE instructor_id = ${instructor.id}
         AND status = 'completed'
       LIMIT 1
    `;
    const isWeekOne = priorCompleted.length === 0;
    const isFullFranchise = franchiseFee === 19500;
    const depositAmount = (isWeekOne && isFullFranchise) ? 25000 : 0;

    const totalDeductionPence = franchiseFee + depositAmount + priorShortfallPence;

    // netOfStripeGross is the budget the franchise math gets to work with —
    // Stripe already took its cut before money landed on the platform.
    if (netOfStripeGross >= totalDeductionPence) {
      // Positive payout — all deductions applied.
      totalInstructorPence = netOfStripeGross - totalDeductionPence;
      actualFranchiseFee = franchiseFee;
      depositDeducted = depositAmount;
      if (priorShortfallPence > 0) shortfallRecoveryId = priorShortfallId;
    } else {
      // Cannot cover all deductions — payout is zero.
      // Cover fee first (always — bounded by net gross), then deposit (partial allowed),
      // then prior shortfall (full-or-nothing — rolls forward unchanged unless fully covered).
      totalInstructorPence = 0;
      actualFranchiseFee = Math.min(franchiseFee, netOfStripeGross);
      const coveredAfterFee = Math.max(0, netOfStripeGross - franchiseFee);
      depositDeducted = Math.min(depositAmount, coveredAfterFee);
      const coveredAfterDeposit = coveredAfterFee - depositDeducted;
      if (priorShortfallPence > 0 && coveredAfterDeposit >= priorShortfallPence) {
        shortfallRecoveryId = priorShortfallId;
      }
      // This week's shortfall = uncovered fee + uncovered deposit (+ prior shortfall only if NOT being recovered).
      // Stripe fees are NEVER in shortfall — they were a pass-through cost, already paid to Stripe.
      const uncoveredFee = franchiseFee - actualFranchiseFee;
      const uncoveredDeposit = depositAmount - depositDeducted;
      const carriedPrior = (priorShortfallPence > 0 && shortfallRecoveryId === null) ? priorShortfallPence : 0;
      shortfallThisWeek = uncoveredFee + uncoveredDeposit + carriedPrior;
    }
  } else {
    // Commission model: instructor gets commission_rate of gross, MINUS Stripe fees
    // (per locked-in Decision 1 — commission on gross, fees subtracted from share).
    totalInstructorPence = 0;
  }

  // Build line items. Each line item records:
  //   price_pence              — gross lesson price (unchanged)
  //   stripe_fee_pence         — Stripe's cut on that booking's funding charge
  //   instructor_amount_pence  — what the instructor actually takes home for that booking
  //                              (already net of Stripe fee and commission/franchise share)
  // The sum of instructor_amount_pence across line items must equal totalInstructorPence
  // exactly; the largest-line-item rounding fix below absorbs any pence drift.
  const effectiveRate = franchiseFee != null
    ? (netOfStripeGross > 0 ? totalInstructorPence / netOfStripeGross : 1)
    : commissionRate;

  let lineItemSum = 0;
  const lineItems = bookings.map(b => {
    const pricePence = parseInt(b.price_pence);
    const stripeFeePence = parseInt(b.stripe_fee_pence || 0);
    // For franchise: per-booking share is (price − fee) × effectiveRate.
    // For commission: per-booking share is (price × rate) − fee.
    const instructorPence = franchiseFee != null
      ? Math.round((pricePence - stripeFeePence) * effectiveRate)
      : Math.round(pricePence * effectiveRate) - stripeFeePence;
    lineItemSum += instructorPence;
    return {
      booking_id: b.booking_id,
      price_pence: pricePence,
      stripe_fee_pence: stripeFeePence,
      instructor_amount_pence: instructorPence,
      commission_rate: Math.round(effectiveRate * 1000) / 1000
    };
  });

  // For commission model, totalInstructorPence is the sum of per-lesson amounts
  if (franchiseFee == null) {
    totalInstructorPence = lineItemSum;
  } else if (lineItems.length > 0 && lineItemSum !== totalInstructorPence) {
    // Fix rounding: adjust largest line item so sum matches exactly
    let maxIdx = 0;
    for (let i = 1; i < lineItems.length; i++) {
      if (lineItems[i].price_pence > lineItems[maxIdx].price_pence) maxIdx = i;
    }
    lineItems[maxIdx].instructor_amount_pence += (totalInstructorPence - lineItemSum);
  }

  const periodStart = bookings[0].scheduled_date;
  const periodEnd = bookings[bookings.length - 1].scheduled_date;

  // Create payout record (now also writes shortfall + deposit columns — plan items 1.3 + 2.10,
  // plus stripe_fees_pence for the historical 4-line earnings breakdown — Step 4f.d).
  const [payout] = await sql`
    INSERT INTO instructor_payouts (
      instructor_id, amount_pence, platform_fee_pence, franchise_fee_pence,
      period_start, period_end, status,
      shortfall_pence, deposit_deducted_pence, stripe_fees_pence
    )
    VALUES (
      ${instructor.id}, ${totalInstructorPence}, ${totalGrossPence - totalInstructorPence}, ${actualFranchiseFee},
      ${periodStart}, ${periodEnd}, 'processing',
      ${shortfallThisWeek}, ${depositDeducted}, ${totalStripeFeesPence}
    )
    RETURNING id
  `;

  // Insert line items (UNIQUE(booking_id) prevents doubles)
  for (const li of lineItems) {
    await sql`
      INSERT INTO payout_line_items (payout_id, booking_id, price_pence, instructor_amount_pence, commission_rate, stripe_fee_pence)
      VALUES (${payout.id}, ${li.booking_id}, ${li.price_pence}, ${li.instructor_amount_pence}, ${li.commission_rate}, ${li.stripe_fee_pence})
    `;
  }

  // Build the success-return shape once — used by both transfer paths.
  const buildResult = (extras) => ({
    payout_id: payout.id,
    instructor_id: instructor.id,
    instructor_name: instructor.name,
    instructor_email: instructor.email,
    amount_pence: totalInstructorPence,
    gross_pence: totalGrossPence,
    stripe_fees_pence: totalStripeFeesPence,
    lesson_count: bookings.length,
    shortfall_pence: shortfallThisWeek,
    deposit_deducted_pence: depositDeducted,
    prior_shortfall_recovered_pence: shortfallRecoveryId !== null ? priorShortfallPence : 0,
    ...extras
  });

  // Zero-payout case (entire gross consumed by fee + deposit + prior shortfall, or commission gross was 0):
  // skip Stripe — it rejects amount=0 — and mark completed. Line items still record £0 attribution.
  if (totalInstructorPence === 0) {
    await sql`
      UPDATE instructor_payouts
         SET status = 'completed', completed_at = NOW()
       WHERE id = ${payout.id}
    `;
    if (shortfallRecoveryId !== null) {
      await sql`
        UPDATE instructor_payouts
           SET shortfall_recovered_from_payout_id = ${payout.id}
         WHERE id = ${shortfallRecoveryId}
      `;
    }
    return buildResult({ status: 'completed' });
  }

  // Create Stripe transfer
  try {
    const transfer = await stripe.transfers.create({
      amount: totalInstructorPence,
      currency: 'gbp',
      destination: instructor.stripe_account_id,
      description: `CoachCarter payout ${periodStart} to ${periodEnd}`,
      metadata: {
        payout_id: String(payout.id),
        instructor_id: String(instructor.id),
        lesson_count: String(bookings.length)
      }
    });

    await sql`
      UPDATE instructor_payouts
         SET status = 'completed', stripe_transfer_id = ${transfer.id}, completed_at = NOW()
       WHERE id = ${payout.id}
    `;

    // Mark prior shortfall recovered ONLY after a successful transfer.
    if (shortfallRecoveryId !== null) {
      await sql`
        UPDATE instructor_payouts
           SET shortfall_recovered_from_payout_id = ${payout.id}
         WHERE id = ${shortfallRecoveryId}
      `;
    }

    return buildResult({ transfer_id: transfer.id, status: 'completed' });
  } catch (err) {
    // Transfer failed — mark payout as failed and DELETE line items so bookings retry next run.
    // Prior shortfall is intentionally NOT marked recovered (rollback safety).
    await sql`
      UPDATE instructor_payouts SET status = 'failed', failure_reason = ${err.message} WHERE id = ${payout.id}
    `;
    await sql`
      DELETE FROM payout_line_items WHERE payout_id = ${payout.id}
    `;
    // Trigger A — alert if the widget said green within the last 24h.
    await alertIfWidgetLied(sql, { payout, instructor, error: err });
    return buildResult({ status: 'failed', error: err.message });
  }
}

/**
 * Process payouts for all eligible instructors. Returns summary.
 */
async function processAllPayouts(sql, stripe) {
  const instructors = await sql`
    SELECT id, name, email, commission_rate, weekly_franchise_fee_pence, stripe_account_id, payouts_start_date
      FROM instructors
     WHERE active = TRUE
       AND stripe_onboarding_complete = TRUE
       AND payouts_paused = FALSE
       AND stripe_account_id IS NOT NULL
  `;

  const results = { processed: 0, skipped: 0, failed: 0, total_pence: 0, details: [] };

  for (const inst of instructors) {
    try {
      const result = await processPayoutForInstructor(sql, stripe, inst);
      if (!result) {
        results.skipped++;
        continue;
      }
      results.details.push(result);
      if (result.status === 'completed') {
        results.processed++;
        results.total_pence += result.amount_pence;
      } else {
        results.failed++;
      }
    } catch (err) {
      results.failed++;
      results.details.push({
        instructor_id: inst.id,
        instructor_name: inst.name,
        status: 'error',
        error: err.message
      });
    }
  }

  return results;
}

/**
 * Get unpaid eligible bookings for a school (all instructors in that school).
 * Excludes bookings already covered by a school_payouts record.
 */
async function getEligibleSchoolBookings(sql, schoolId) {
  return sql`
    SELECT lb.id AS booking_id,
           lb.scheduled_date,
           lb.instructor_id,
           CASE WHEN iln.custom_hourly_rate_pence IS NOT NULL
             THEN ROUND(iln.custom_hourly_rate_pence * COALESCE(lt.duration_minutes, 90) / 60.0)
             ELSE COALESCE(lt.price_pence, 8250)
           END AS price_pence,
           COALESCE(lt.name, 'Standard Lesson') AS lesson_type_name
      FROM lesson_bookings lb
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN instructor_learner_notes iln ON iln.instructor_id = lb.instructor_id AND iln.learner_id = lb.learner_id
     WHERE lb.school_id = ${schoolId}
       AND lb.status = ${CHARGEABLE}
       AND lb.id NOT IN (
         SELECT unnest(booking_ids) FROM school_payouts WHERE school_id = ${schoolId} AND status = 'completed'
       )
     ORDER BY lb.scheduled_date ASC
  `;
}

/**
 * Process payouts for all schools with active Stripe Connect.
 * Each school receives (total lesson revenue - platform fee) transferred to their Connect account.
 */
async function processSchoolPayouts(sql, stripe) {
  const schools = await sql`
    SELECT id, name, stripe_account_id, platform_fee_pct
      FROM schools
     WHERE active = TRUE
       AND stripe_onboarding_complete = TRUE
       AND stripe_account_id IS NOT NULL
  `;

  const results = { processed: 0, skipped: 0, failed: 0, total_pence: 0, details: [] };

  for (const school of schools) {
    try {
      const bookings = await getEligibleSchoolBookings(sql, school.id);
      if (!bookings.length) {
        results.skipped++;
        continue;
      }

      let totalGrossPence = 0;
      const bookingIds = [];
      for (const b of bookings) {
        totalGrossPence += parseInt(b.price_pence);
        bookingIds.push(b.booking_id);
      }

      const feeRate = parseFloat(school.platform_fee_pct) || 0;
      const platformFeePence = Math.round(totalGrossPence * feeRate / 100);
      const schoolPayoutPence = totalGrossPence - platformFeePence;

      if (schoolPayoutPence <= 0) {
        results.skipped++;
        continue;
      }

      const periodStart = bookings[0].scheduled_date;
      const periodEnd = bookings[bookings.length - 1].scheduled_date;

      // Create school payout record
      const [payout] = await sql`
        INSERT INTO school_payouts (school_id, amount_pence, platform_fee_pence, period_start, period_end, booking_ids, status)
        VALUES (${school.id}, ${schoolPayoutPence}, ${platformFeePence}, ${periodStart}, ${periodEnd}, ${bookingIds}, 'processing')
        RETURNING id
      `;

      // Create Stripe transfer
      try {
        const transfer = await stripe.transfers.create({
          amount: schoolPayoutPence,
          currency: 'gbp',
          destination: school.stripe_account_id,
          description: `CoachCarter school payout ${periodStart} to ${periodEnd}`,
          metadata: {
            school_payout_id: String(payout.id),
            school_id: String(school.id),
            lesson_count: String(bookings.length)
          }
        });

        await sql`
          UPDATE school_payouts
             SET status = 'completed', stripe_transfer_id = ${transfer.id}, completed_at = NOW()
           WHERE id = ${payout.id}
        `;

        results.processed++;
        results.total_pence += schoolPayoutPence;
        results.details.push({
          payout_id: payout.id,
          school_id: school.id,
          school_name: school.name,
          amount_pence: schoolPayoutPence,
          platform_fee_pence: platformFeePence,
          lesson_count: bookings.length,
          transfer_id: transfer.id,
          status: 'completed'
        });
      } catch (err) {
        // Transfer failed — mark payout as failed and clear booking_ids so they retry next run
        await sql`
          UPDATE school_payouts SET status = 'failed', failure_reason = ${err.message}, booking_ids = '{}' WHERE id = ${payout.id}
        `;
        results.failed++;
        results.details.push({
          payout_id: payout.id,
          school_id: school.id,
          school_name: school.name,
          amount_pence: schoolPayoutPence,
          lesson_count: bookings.length,
          status: 'failed',
          error: err.message
        });
      }
    } catch (err) {
      results.failed++;
      results.details.push({
        school_id: school.id,
        school_name: school.name,
        status: 'error',
        error: err.message
      });
    }
  }

  return results;
}

/**
 * Read-only dry-run of processPayoutForInstructor — same math, no INSERT/UPDATE,
 * no Stripe call. Used by the platform-balance widget to preview Friday's
 * payout. Mirrors the franchise/commission branch and Stripe-fee handling in
 * processPayoutForInstructor exactly; the two must stay in lockstep.
 *
 * Returns null when the instructor has no eligible lessons (matches the
 * "skipped" branch in processAllPayouts). Otherwise returns the same shape
 * processPayoutForInstructor returns via buildResult — minus payout_id /
 * transfer_id (none created) and status.
 */
async function simulatePayoutForInstructor(sql, instructor) {
  const bookings = await getEligibleBookings(sql, instructor.id, instructor.payouts_start_date || null);
  if (!bookings.length) return null;

  const franchiseFee = instructor.weekly_franchise_fee_pence != null
    ? parseInt(instructor.weekly_franchise_fee_pence) : null;
  const commissionRate = parseFloat(instructor.commission_rate) || 0.85;

  let totalGrossPence = 0;
  let totalStripeFeesPence = 0;
  for (const b of bookings) {
    totalGrossPence += parseInt(b.price_pence);
    totalStripeFeesPence += parseInt(b.stripe_fee_pence || 0);
  }
  const netOfStripeGross = totalGrossPence - totalStripeFeesPence;

  let totalInstructorPence;
  let actualFranchiseFee = null;
  let shortfallThisWeek = 0;
  let depositDeducted = 0;
  let priorShortfallPence = 0;
  let priorShortfallId = null;
  let shortfallRecoveryId = null;

  if (franchiseFee != null) {
    const priorRows = await sql`
      SELECT id, shortfall_pence
        FROM instructor_payouts
       WHERE instructor_id = ${instructor.id}
         AND status = 'completed'
         AND shortfall_pence > 0
         AND shortfall_recovered_from_payout_id IS NULL
       ORDER BY period_end DESC
       LIMIT 1
    `;
    if (priorRows.length) {
      priorShortfallPence = parseInt(priorRows[0].shortfall_pence);
      priorShortfallId = priorRows[0].id;
    }

    const priorCompleted = await sql`
      SELECT 1 FROM instructor_payouts
       WHERE instructor_id = ${instructor.id}
         AND status = 'completed'
       LIMIT 1
    `;
    const isWeekOne = priorCompleted.length === 0;
    const isFullFranchise = franchiseFee === 19500;
    const depositAmount = (isWeekOne && isFullFranchise) ? 25000 : 0;

    const totalDeductionPence = franchiseFee + depositAmount + priorShortfallPence;

    if (netOfStripeGross >= totalDeductionPence) {
      totalInstructorPence = netOfStripeGross - totalDeductionPence;
      actualFranchiseFee = franchiseFee;
      depositDeducted = depositAmount;
      if (priorShortfallPence > 0) shortfallRecoveryId = priorShortfallId;
    } else {
      totalInstructorPence = 0;
      actualFranchiseFee = Math.min(franchiseFee, netOfStripeGross);
      const coveredAfterFee = Math.max(0, netOfStripeGross - franchiseFee);
      depositDeducted = Math.min(depositAmount, coveredAfterFee);
      const coveredAfterDeposit = coveredAfterFee - depositDeducted;
      if (priorShortfallPence > 0 && coveredAfterDeposit >= priorShortfallPence) {
        shortfallRecoveryId = priorShortfallId;
      }
      const uncoveredFee = franchiseFee - actualFranchiseFee;
      const uncoveredDeposit = depositAmount - depositDeducted;
      const carriedPrior = (priorShortfallPence > 0 && shortfallRecoveryId === null) ? priorShortfallPence : 0;
      shortfallThisWeek = uncoveredFee + uncoveredDeposit + carriedPrior;
    }
  } else {
    // Commission model — per-booking math then sum (matches real path)
    let lineSum = 0;
    for (const b of bookings) {
      const pricePence = parseInt(b.price_pence);
      const stripeFeePence = parseInt(b.stripe_fee_pence || 0);
      lineSum += Math.round(pricePence * commissionRate) - stripeFeePence;
    }
    totalInstructorPence = lineSum;
  }

  return {
    instructor_id: instructor.id,
    instructor_name: instructor.name,
    instructor_email: instructor.email,
    fee_model: franchiseFee != null ? 'franchise' : 'commission',
    amount_pence: totalInstructorPence,
    gross_pence: totalGrossPence,
    stripe_fees_pence: totalStripeFeesPence,
    lesson_count: bookings.length,
    franchise_fee_pence: actualFranchiseFee,
    shortfall_pence: shortfallThisWeek,
    deposit_deducted_pence: depositDeducted,
    prior_shortfall_recovered_pence: shortfallRecoveryId !== null ? priorShortfallPence : 0
  };
}

module.exports = { getEligibleBookings, processPayoutForInstructor, processAllPayouts, processSchoolPayouts, simulatePayoutForInstructor };
