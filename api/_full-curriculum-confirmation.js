'use strict';

const { createTransporter } = require('./_auth-helpers');
const { sha256 } = require('./_full-curriculum-consumer-rights');

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function formatGbp(pence) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
    .format(Number(pence || 0) / 100);
}

function safeFailureCode(error) {
  const candidate = String(error?.code || 'EMAIL_DELIVERY_FAILED').toUpperCase();
  return /^[A-Z0-9_]{2,80}$/.test(candidate) ? candidate : 'EMAIL_DELIVERY_FAILED';
}

async function sendFullCurriculumDurableConfirmation({
  sql,
  attemptId,
  schoolId,
  createMailer = createTransporter,
}) {
  const delivered = await sql`
    SELECT id FROM full_curriculum_contract_events
     WHERE school_id = ${schoolId}
       AND attempt_id = ${attemptId}::uuid
       AND event_type = 'durable_confirmation_delivered'
     LIMIT 1
  `;
  if (delivered[0]) return { delivered: true, reused: true };

  const rows = await sql`
    SELECT attempt.id AS attempt_id, attempt.product_name, attempt.product_snapshot,
           attempt.amount_pence, attempt.currency, attempt.customer_terms_version,
           purchase.id AS purchase_id, enrolment.id AS enrolment_id,
           enrolment.contract_formed_at, enrolment.cooling_off_expires_at,
           enrolment.service_may_start_at, enrolment.matching_deadline,
           evidence.policy_version, evidence.disclosure_version,
           evidence.refund_calculation_version, evidence.disclosure_snapshot,
           evidence.early_start_requested, evidence.adult_age_confirmed,
           evidence.start_request_text, evidence.acknowledged_at,
           learner.id AS learner_id, learner.name AS learner_name, learner.email,
           school.name AS school_name,
           COALESCE(NULLIF(attempt.eligibility_snapshot->>'timezone', ''),
                    NULLIF(school.config->>'timezone', ''), 'Europe/London') AS timezone
      FROM package_purchase_attempts attempt
      JOIN learner_package_purchases purchase
        ON purchase.attempt_id = attempt.id AND purchase.school_id = ${schoolId}
      JOIN full_curriculum_enrolments enrolment
        ON enrolment.purchase_id = purchase.id AND enrolment.school_id = ${schoolId}
      JOIN full_curriculum_consumer_contract_evidence evidence
        ON evidence.attempt_id = attempt.id AND evidence.school_id = ${schoolId}
      JOIN learner_users learner
        ON learner.id = attempt.learner_id AND learner.school_id = ${schoolId}
      JOIN schools school ON school.id = ${schoolId}
     WHERE attempt.id = ${attemptId}::uuid
       AND attempt.school_id = ${schoolId}
       AND attempt.status = 'paid'
       AND evidence.adult_age_confirmed = TRUE
     LIMIT 1
  `;
  const contract = rows[0];
  if (!contract?.email) {
    const error = new Error('Paid Full Curriculum contract lacks a verified confirmation recipient');
    error.code = 'DURABLE_CONFIRMATION_EVIDENCE_MISSING';
    throw error;
  }

  const confirmationSnapshot = {
    confirmation_version: 'full-curriculum-durable-confirmation-v1',
    school_name: contract.school_name,
    product_name: contract.product_name,
    amount_pence: Number(contract.amount_pence),
    currency: contract.currency,
    customer_terms_version: contract.customer_terms_version,
    policy_version: contract.policy_version,
    disclosure_version: contract.disclosure_version,
    refund_calculation_version: contract.refund_calculation_version,
    contract_formed_at: contract.contract_formed_at,
    cooling_off_expires_at: contract.cooling_off_expires_at,
    service_may_start_at: contract.service_may_start_at,
    matching_deadline: contract.matching_deadline,
    early_start_requested: contract.early_start_requested === true,
    adult_age_confirmed: contract.adult_age_confirmed === true,
    start_request_text: contract.start_request_text,
    acknowledged_at: contract.acknowledged_at,
    consumer_contract: contract.disclosure_snapshot,
    purchased_product_terms: contract.product_snapshot,
    cancellation: {
      self_service: 'Sign in to the learner Packages page and use Record my cancellation request.',
      email: 'bookings@coachcarter.uk',
      refund_destination: 'Original payment method unless it fails and a documented alternative is agreed.',
    },
  };
  const attachment = JSON.stringify(confirmationSnapshot, null, 2);
  const stableMessageId = `<full-curriculum-${attemptId}@coachcarter.uk>`;
  const timezone = contract.timezone || 'Europe/London';
  await sql`
    INSERT INTO full_curriculum_contract_events (
      school_id, attempt_id, purchase_id, enrolment_id, event_type,
      actor_type, detail, occurred_at
    ) VALUES (
      ${schoolId}, ${attemptId}::uuid, ${contract.purchase_id}, ${contract.enrolment_id},
      'durable_confirmation_queued', 'system',
      ${JSON.stringify({
        confirmation_version: confirmationSnapshot.confirmation_version,
        message_id: stableMessageId,
        recipient_sha256: sha256(contract.email.trim().toLowerCase()),
        attachment_sha256: sha256(attachment),
      })}::jsonb, NOW()
    )
  `;

  try {
    const mailer = createMailer();
    await mailer.sendMail({
      _log: {
        purpose: 'full_curriculum.durable_contract_confirmation',
        learnerId: contract.learner_id,
        schoolId,
      },
      from: 'CoachCarter <bookings@coachcarter.uk>',
      replyTo: 'bookings@coachcarter.uk',
      to: contract.email,
      messageId: stableMessageId,
      subject: 'Your Full Curriculum purchase terms and cancellation information',
      text: [
        `Hi ${contract.learner_name || 'there'},`,
        '',
        `This confirms your ${contract.product_name} purchase for ${formatGbp(contract.amount_pence)}.`,
        `Terms version: ${contract.customer_terms_version}.`,
        `Your 14-day cancellation period runs until ${new Date(contract.cooling_off_expires_at).toLocaleString('en-GB', { timeZone: timezone })}.`,
        contract.early_start_requested
          ? 'You expressly asked us to begin services during that period.'
          : `You chose to wait. Matching may begin from ${new Date(contract.service_may_start_at).toLocaleString('en-GB', { timeZone: timezone })}.`,
        '',
        'Matching, administration and the original Stripe fee have no deductible value.',
        'To cancel, use the learner Packages page or email bookings@coachcarter.uk.',
        'Any refund normally goes to the original payment method.',
        '',
        'The attached file is the durable copy of the exact purchased terms and recorded choices.',
      ].join('\n'),
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;line-height:1.6;color:#262626">
        <h1>Your Full Curriculum purchase</h1>
        <p>Hi ${escapeHtml(contract.learner_name || 'there')},</p>
        <p>This confirms your <strong>${escapeHtml(contract.product_name)}</strong> purchase for <strong>${escapeHtml(formatGbp(contract.amount_pence))}</strong>.</p>
        <ul>
          <li>Terms version: ${escapeHtml(contract.customer_terms_version)}</li>
          <li>Cancellation period ends: ${escapeHtml(new Date(contract.cooling_off_expires_at).toLocaleString('en-GB', { timeZone: timezone }))}</li>
          <li>${contract.early_start_requested ? 'You expressly requested an early start.' : `Matching may begin from ${escapeHtml(new Date(contract.service_may_start_at).toLocaleString('en-GB', { timeZone: timezone }))}.`}</li>
        </ul>
        <p>Matching, administration and the original Stripe fee have no deductible value. To cancel, use the learner Packages page or email <a href="mailto:bookings@coachcarter.uk">bookings@coachcarter.uk</a>. Any refund normally goes to the original payment method.</p>
        <p>The attached file is the durable copy of the exact purchased terms and recorded choices.</p>
      </div>`,
      attachments: [{
        filename: `full-curriculum-terms-${attemptId}.json`,
        content: attachment,
        contentType: 'application/json; charset=utf-8',
      }],
    });
    await sql`
      INSERT INTO full_curriculum_contract_events (
        school_id, attempt_id, purchase_id, enrolment_id, event_type,
        actor_type, detail, occurred_at
      ) VALUES (
        ${schoolId}, ${attemptId}::uuid, ${contract.purchase_id}, ${contract.enrolment_id},
        'durable_confirmation_delivered', 'system',
        ${JSON.stringify({
          confirmation_version: confirmationSnapshot.confirmation_version,
          message_id: stableMessageId,
          recipient_sha256: sha256(contract.email.trim().toLowerCase()),
          attachment_sha256: sha256(attachment),
        })}::jsonb, NOW()
      )
      ON CONFLICT DO NOTHING
    `;
    return { delivered: true, reused: false };
  } catch (cause) {
    await sql`
      INSERT INTO full_curriculum_contract_events (
        school_id, attempt_id, purchase_id, enrolment_id, event_type,
        actor_type, detail, occurred_at
      ) VALUES (
        ${schoolId}, ${attemptId}::uuid, ${contract.purchase_id}, ${contract.enrolment_id},
        'durable_confirmation_failed', 'system',
        ${JSON.stringify({
          confirmation_version: confirmationSnapshot.confirmation_version,
          failure_code: safeFailureCode(cause),
        })}::jsonb, NOW()
      )
    `;
    const error = new Error('Full Curriculum durable confirmation was not delivered');
    error.code = 'DURABLE_CONFIRMATION_FAILED';
    error.cause = cause;
    throw error;
  }
}

module.exports = { sendFullCurriculumDurableConfirmation };
