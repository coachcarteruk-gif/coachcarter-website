/**
 * Shared payout logic used by cron-payouts.js and admin manual trigger.
 *
 * Eligible bookings: status='completed' OR (status='confirmed' AND scheduled_date <= NOW() - 3 days)
 * Safety: UNIQUE(booking_id) on payout_line_items prevents double-payment.
 */

/**
 * Get unpaid eligible bookings for an instructor.
 * `payoutsStartDate` is a date floor — bookings before it are excluded. NULL/undefined = no floor.
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
           COALESCE(lt.duration_minutes, 90) AS duration_minutes,
           COALESCE(lt.name, 'Standard Lesson') AS lesson_type_name
      FROM lesson_bookings lb
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN instructor_learner_notes iln ON iln.instructor_id = lb.instructor_id AND iln.learner_id = lb.learner_id
      LEFT JOIN payout_line_items pli ON pli.booking_id = lb.id
     WHERE lb.instructor_id = ${instructorId}
       AND pli.id IS NULL
       AND (${payoutsStartDate}::date IS NULL OR lb.scheduled_date >= ${payoutsStartDate}::date)
       AND (
         lb.status = 'completed'
         OR (lb.status = 'confirmed' AND lb.scheduled_date <= CURRENT_DATE - INTERVAL '3 days')
       )
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
  for (const b of bookings) totalGrossPence += parseInt(b.price_pence);

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

    if (totalGrossPence >= totalDeductionPence) {
      // Positive payout — all deductions applied.
      totalInstructorPence = totalGrossPence - totalDeductionPence;
      actualFranchiseFee = franchiseFee;
      depositDeducted = depositAmount;
      if (priorShortfallPence > 0) shortfallRecoveryId = priorShortfallId;
    } else {
      // Cannot cover all deductions — payout is zero.
      // Cover fee first (always — bounded by gross), then deposit (partial allowed),
      // then prior shortfall (full-or-nothing — rolls forward unchanged unless fully covered).
      totalInstructorPence = 0;
      actualFranchiseFee = Math.min(franchiseFee, totalGrossPence);
      const coveredAfterFee = Math.max(0, totalGrossPence - franchiseFee);
      depositDeducted = Math.min(depositAmount, coveredAfterFee);
      const coveredAfterDeposit = coveredAfterFee - depositDeducted;
      if (priorShortfallPence > 0 && coveredAfterDeposit >= priorShortfallPence) {
        shortfallRecoveryId = priorShortfallId;
      }
      // This week's shortfall = uncovered fee + uncovered deposit (+ prior shortfall only if NOT being recovered).
      const uncoveredFee = franchiseFee - actualFranchiseFee;
      const uncoveredDeposit = depositAmount - depositDeducted;
      const carriedPrior = (priorShortfallPence > 0 && shortfallRecoveryId === null) ? priorShortfallPence : 0;
      shortfallThisWeek = uncoveredFee + uncoveredDeposit + carriedPrior;
    }
  } else {
    // Commission model: instructor gets commission_rate of each lesson
    totalInstructorPence = 0;
  }

  // Build line items
  const effectiveRate = franchiseFee != null
    ? (totalGrossPence > 0 ? totalInstructorPence / totalGrossPence : 1)
    : commissionRate;

  let lineItemSum = 0;
  const lineItems = bookings.map(b => {
    const pricePence = parseInt(b.price_pence);
    const instructorPence = Math.round(pricePence * effectiveRate);
    lineItemSum += instructorPence;
    return {
      booking_id: b.booking_id,
      price_pence: pricePence,
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

  // Create payout record (now also writes shortfall + deposit columns — plan items 1.3 + 2.10).
  const [payout] = await sql`
    INSERT INTO instructor_payouts (
      instructor_id, amount_pence, platform_fee_pence, franchise_fee_pence,
      period_start, period_end, status,
      shortfall_pence, deposit_deducted_pence
    )
    VALUES (
      ${instructor.id}, ${totalInstructorPence}, ${totalGrossPence - totalInstructorPence}, ${actualFranchiseFee},
      ${periodStart}, ${periodEnd}, 'processing',
      ${shortfallThisWeek}, ${depositDeducted}
    )
    RETURNING id
  `;

  // Insert line items (UNIQUE(booking_id) prevents doubles)
  for (const li of lineItems) {
    await sql`
      INSERT INTO payout_line_items (payout_id, booking_id, price_pence, instructor_amount_pence, commission_rate)
      VALUES (${payout.id}, ${li.booking_id}, ${li.price_pence}, ${li.instructor_amount_pence}, ${li.commission_rate})
    `;
  }

  // Build the success-return shape once — used by both transfer paths.
  const buildResult = (extras) => ({
    payout_id: payout.id,
    instructor_id: instructor.id,
    instructor_name: instructor.name,
    instructor_email: instructor.email,
    amount_pence: totalInstructorPence,
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
       AND (
         lb.status = 'completed'
         OR (lb.status = 'confirmed' AND lb.scheduled_date <= CURRENT_DATE - INTERVAL '3 days')
       )
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

module.exports = { getEligibleBookings, processPayoutForInstructor, processAllPayouts, processSchoolPayouts };
