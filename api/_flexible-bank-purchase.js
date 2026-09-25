'use strict';

const crypto = require('crypto');
const { logAuditRequired } = require('./_audit');
const { isUuid, FLEXIBLE_HOURS_DISCLOSURE_VERSION, FLEXIBLE_PACKAGE_SLUGS, isFlexiblePackageLivePurchasingEnabled } = require('./_flexible-package-payments');

class BankPurchaseError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function reject(status, code, message) { throw new BankPurchaseError(status, code, message); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }

// Prices and hours come only from the school's immutable current catalogue version.
function bankProductTerms(product) {
  const units = Number(product?.content?.entitlement?.units);
  const price = Number(product?.price_pence);
  const rate = Number((price / units).toFixed(6));
  if (product?.product_type !== 'flexible_hours' || product.currency !== 'GBP'
      || !FLEXIBLE_PACKAGE_SLUGS.includes(product.product_slug)
      || !Number.isSafeInteger(units) || units <= 0
      || !Number.isSafeInteger(units * 30) || !Number.isFinite(rate) || rate <= 0
      || Number(product.content?.entitlement?.unit_minutes) !== 30
      || product.content?.entitlement?.scope !== 'school'
      || !Number.isSafeInteger(price) || price <= 0 || price > 1000000
      || !product.customer_terms_version
      || product.content?.consumer_rights?.disclosure_version !== FLEXIBLE_HOURS_DISCLOSURE_VERSION) return null;
  return { amountPence: price, totalUnits: units, unitMinutes: 30, ratePencePerUnit: rate };
}

function validateBankPurchase(body, now = new Date()) {
  const input = {
    requestId: text(body?.client_request_id).toLowerCase(),
    learnerId: Number(body?.learner_id),
    productVersionId: Number(body?.product_version_id),
    amountPence: body?.amount_pence,
    receivedOn: text(body?.received_on),
    bankReference: text(body?.bank_reference).normalize('NFKC').replace(/\s+/g, ' '),
    consentEvidence: text(body?.consent_evidence_reference),
    reason: text(body?.reason),
  };
  if (!isUuid(input.requestId) || !Number.isSafeInteger(input.learnerId) || input.learnerId <= 0
      || !Number.isSafeInteger(input.productVersionId) || input.productVersionId <= 0
      || !Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) {
    reject(400, 'INVALID_BANK_PURCHASE', 'Choose a learner and package, and enter the received amount.');
  }
  const date = new Date(input.receivedOn + 'T00:00:00.000Z');
  // The school operates in the UK; a local date can be one day ahead of UTC.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) || Number.isNaN(date.getTime())
      || date.toISOString().slice(0, 10) !== input.receivedOn || input.receivedOn > today) {
    reject(400, 'INVALID_RECEIPT_DATE', 'Enter a valid payment date that is not in the future.');
  }
  if (input.bankReference.length < 3 || input.bankReference.length > 200
      || input.consentEvidence.length < 3 || input.consentEvidence.length > 500
      || input.reason.length < 2 || input.reason.length > 1000) {
    reject(400, 'BANK_EVIDENCE_REQUIRED', 'Provide the bank transaction reference, consent evidence reference and audit reason.');
  }
  if (body.funds_received_confirmed !== true || body.adult_age_confirmed !== true
      || body.consumer_terms_accepted !== true || body.immediate_access_requested !== true
      || body.disclosure_version !== FLEXIBLE_HOURS_DISCLOSURE_VERSION) {
    reject(400, 'BANK_ATTESTATION_REQUIRED', 'Confirm cleared funds and the learner’s recorded adult declaration, terms acceptance and immediate-access request.');
  }
  input.referenceHash = hash(input.bankReference.toUpperCase());
  input.requestHash = hash(JSON.stringify([input.learnerId, input.productVersionId, input.amountPence,
    input.receivedOn, input.referenceHash, input.consentEvidence, input.reason, body.disclosure_version]));
  return input;
}

async function recordBankPurchase(client, { input, schoolId, admin, req }) {
  // Same learner lock as package bookings. Unique reference also serialises different learners/admins.
  const learner = (await client.query(
    'SELECT id, email_verified FROM learner_users WHERE id=$1 AND school_id=$2 FOR UPDATE',
    [input.learnerId, schoolId]
  )).rows[0];
  if (!learner) reject(404, 'LEARNER_NOT_FOUND', 'Learner not found in this school.');
  const existing = (await client.query(
    `SELECT receipt.id, receipt.request_sha256, purchase.id AS purchase_id, source.id AS source_id,
            purchase.total_units, purchase.unit_minutes, purchase.amount_pence
       FROM flexible_package_bank_receipts receipt
       LEFT JOIN flexible_package_purchases purchase ON purchase.bank_receipt_id=receipt.id AND purchase.school_id=$1
       LEFT JOIN flexible_package_sources source ON source.purchase_id=purchase.id AND source.school_id=$1
      WHERE receipt.school_id=$1 AND (receipt.id=$2::uuid OR receipt.reference_sha256=$3)`,
    [schoolId, input.requestId, input.referenceHash]
  )).rows;
  if (existing.length) {
    const row = existing[0];
    if (existing.length !== 1 || row.request_sha256 !== input.requestHash) {
      reject(409, 'BANK_RECEIPT_CONFLICT', 'This request or bank transaction reference was already recorded with different details. Review the purchase history.');
    }
    if (!row.purchase_id || !row.source_id) reject(409, 'BANK_RECEIPT_INCOMPLETE', 'The existing receipt requires reconciliation. No hours were added.');
    return { ok: true, reused: true, receipt_id: row.id, purchase_id: row.purchase_id,
      source_id: row.source_id, minutes_added: Number(row.total_units) * Number(row.unit_minutes), amount_pence: Number(row.amount_pence) };
  }
  const school = (await client.query('SELECT config FROM schools WHERE id=$1 AND active=TRUE FOR SHARE', [schoolId])).rows[0];
  if (!school || !isFlexiblePackageLivePurchasingEnabled(school.config, schoolId)) {
    reject(409, 'FLEXIBLE_PACKAGE_LIVE_PURCHASING_DISABLED', 'Flexible Hours purchasing is not enabled for this school.');
  }
  if (learner.email_verified !== true) reject(409, 'VERIFIED_LEARNER_REQUIRED', 'The learner must verify their email before hours can be added.');
  const product = (await client.query(
    `SELECT p.id AS product_id, p.slug AS product_slug, p.product_type,
            v.id AS product_version_id, v.price_pence, v.currency, v.content, v.customer_terms_version
       FROM package_products p
       JOIN LATERAL (SELECT * FROM package_product_versions candidate
         WHERE candidate.school_id=$1 AND candidate.product_id=p.id AND candidate.effective_from<=NOW()
         ORDER BY candidate.effective_from DESC, candidate.version_number DESC LIMIT 1) v ON TRUE
      WHERE p.school_id=$1 AND p.active=TRUE AND p.visible=TRUE
        AND p.product_type='flexible_hours' AND v.id=$2 FOR SHARE OF p`,
    [schoolId, input.productVersionId]
  )).rows[0];
  const terms = bankProductTerms(product);
  if (!terms) reject(409, 'PACKAGE_VERSION_CHANGED', 'Reload the current package. Its price or availability has changed.');
  if (terms.amountPence !== input.amountPence) reject(409, 'BANK_AMOUNT_MISMATCH', 'The received amount must equal the current package price. No hours were added.');
  const pending = await client.query(
    `SELECT id FROM flexible_package_purchase_attempts WHERE school_id=$1 AND learner_id=$2
      AND status IN ('created','submitting','pending','review_required') LIMIT 1`, [schoolId, input.learnerId]
  );
  if (pending.rows.length) reject(409, 'OPEN_FLEXIBLE_CHECKOUT', 'This learner has an unresolved online package checkout. Resolve it before recording a bank transfer.');

  await client.query(
    `INSERT INTO flexible_package_bank_receipts
      (id,school_id,learner_id,product_version_id,amount_pence,received_on,bank_reference,
       reference_sha256,request_sha256,consent_evidence_reference,reason,recorded_by_admin_id,
       recorded_by_role,disclosure_version,adult_age_confirmed,terms_accepted,immediate_access_requested)
     VALUES ($1::uuid,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,TRUE,TRUE)`,
    [input.requestId,schoolId,input.learnerId,input.productVersionId,terms.amountPence,input.receivedOn,
      input.bankReference,input.referenceHash,input.requestHash,input.consentEvidence,input.reason,
      admin.id,admin.role || 'admin',FLEXIBLE_HOURS_DISCLOSURE_VERSION]
  );
  const purchase = (await client.query(
    `INSERT INTO flexible_package_purchases
      (school_id,learner_id,product_id,product_version_id,product_slug,product_snapshot,
       amount_pence,currency,total_units,unit_minutes,rate_pence_per_unit,customer_terms_version,
       paid_at,payment_provider,bank_receipt_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'GBP',$8,30,$9,$10,
       ($11::date::timestamp AT TIME ZONE 'Europe/London'),'bank_transfer',$12::uuid) RETURNING id`,
    [schoolId,input.learnerId,product.product_id,product.product_version_id,product.product_slug,
      JSON.stringify(product.content),terms.amountPence,terms.totalUnits,terms.ratePencePerUnit,
      product.customer_terms_version,input.receivedOn,input.requestId]
  )).rows[0];
  const source = (await client.query(
    `INSERT INTO flexible_package_sources
      (school_id,learner_id,purchase_id,product_version_id,initial_units,unit_minutes,
       rate_pence_per_unit,original_value_pence,original_stripe_fee_pence,stripe_fee_evidence,available_at)
     VALUES ($1,$2,$3,$4,$5,30,$6,$7,0,$8::jsonb,NOW()) RETURNING id`,
    [schoolId,input.learnerId,purchase.id,product.product_version_id,terms.totalUnits,terms.ratePencePerUnit,
      terms.amountPence,JSON.stringify({ payment_provider: 'bank_transfer', bank_receipt_id: input.requestId, stripe_processed: false })]
  )).rows[0];
  const detail = { bank_receipt_id: input.requestId, payment_provider: 'bank_transfer',
    total_units: terms.totalUnits, amount_pence: terms.amountPence, recorded_by_role: admin.role || 'admin' };
  await client.query(
    `INSERT INTO flexible_package_state_events (school_id,learner_id,event_type,purchase_id,source_id,detail)
     VALUES ($1,$2,'bank_transfer_entitlement_created',$3,$4,$5::jsonb)`,
    [schoolId,input.learnerId,purchase.id,source.id,JSON.stringify(detail)]
  );
  const sql = async (strings, ...values) => (await client.query(
    strings.reduce((query, part, index) => query + (index ? '$' + index : '') + part, ''), values
  )).rows;
  await logAuditRequired(sql, { adminId: admin.id, adminEmail: admin.email,
    action: 'flexible-package-bank-purchase', targetType: 'learner', targetId: input.learnerId,
    schoolId, req, details: { ...detail, purchase_id: purchase.id, source_id: source.id } });
  return { ok: true, reused: false, receipt_id: input.requestId, purchase_id: purchase.id,
    source_id: source.id, minutes_added: terms.totalUnits * 30, amount_pence: terms.amountPence };
}

module.exports = { BankPurchaseError, bankProductTerms, validateBankPurchase, recordBankPurchase };
