/**
 * Shared pricing helpers for bulk-credit purchases.
 *
 * Bulk credits are priced per-school via schools.config.pricing:
 *   - bulk_hourly_pence    : integer pence per hour (e.g. 5500 = £55/hr)
 *   - bulk_discount_tiers  : array of { min_hours, discount_pct }, sorted ascending by min_hours
 *
 * If a school has no bulk_hourly_pence configured, fall back to the school's
 * standard 90-min lesson type's implicit hourly rate (price_pence / 1.5).
 * If no tiers configured, no bulk discount is applied.
 *
 * Instructor-scoped credit purchases use the same rate precedence as booking:
 * custom learner rate, then instructor rate, then school default. School tiers
 * apply only when the selected instructor has bulk_tiers_enabled.
 */

const MAX_HOURS_PER_PURCHASE = 36;
const HARD_FALLBACK_HOURLY_PENCE = 5500; // £55/hr — only used if school has neither
                                          // bulk_hourly_pence nor an active 90-min lesson type.

/**
 * Returns { hourlyPence, discountTiers, source } for a given school.
 *  - hourlyPence: integer pence per hour
 *  - discountTiers: array sorted DESCENDING by min_hours (so first match wins)
 *  - source: 'config' | 'lesson_types' | 'fallback' (for logging / debugging)
 *
 * Never throws — always returns a usable rate. Server-side only.
 */
async function getBulkPricing(sql, schoolId) {
  const sid = parseInt(schoolId) || 1;

  // 1. Try schools.config.pricing first
  const [school] = await sql`
    SELECT config FROM schools WHERE id = ${sid}
  `;
  const pricing = school?.config?.pricing || {};

  let hourlyPence = null;
  let source = null;

  if (Number.isInteger(pricing.bulk_hourly_pence) && pricing.bulk_hourly_pence > 0) {
    hourlyPence = pricing.bulk_hourly_pence;
    source = 'config';
  }

  // 2. Fall back to standard 90-min lesson type for this school
  if (!hourlyPence) {
    const [standardLt] = await sql`
      SELECT price_pence, duration_minutes
        FROM lesson_types
       WHERE school_id = ${sid}
         AND duration_minutes = 90
         AND active = true
       ORDER BY sort_order, id
       LIMIT 1
    `;
    if (standardLt?.price_pence && standardLt.duration_minutes) {
      hourlyPence = Math.round(standardLt.price_pence / (standardLt.duration_minutes / 60));
      source = 'lesson_types';
    }
  }

  // 3. Last-resort fallback (only fires if school has no 90-min lesson type at all)
  if (!hourlyPence) {
    hourlyPence = HARD_FALLBACK_HOURLY_PENCE;
    source = 'fallback';
  }

  // Discount tiers: sanitise + sort descending so first match wins
  const rawTiers = Array.isArray(pricing.bulk_discount_tiers) ? pricing.bulk_discount_tiers : [];
  const discountTiers = rawTiers
    .filter(t => Number.isFinite(t?.min_hours) && Number.isFinite(t?.discount_pct))
    .map(t => ({ min_hours: Number(t.min_hours), discount_pct: Number(t.discount_pct) }))
    .sort((a, b) => b.min_hours - a.min_hours);

  return { hourlyPence, discountTiers, source };
}

/**
 * Given a tier list (sorted DESCENDING by min_hours) and an hours count,
 * returns the discount percentage (0 if no tier matches).
 */
function getDiscountPct(hours, discountTiers) {
  if (!Array.isArray(discountTiers) || !discountTiers.length) return 0;
  const tier = discountTiers.find(t => hours >= t.min_hours);
  return tier ? tier.discount_pct : 0;
}

/**
 * Three-level pricing fallback (most-specific wins). Authenticated callers
 * only — learnerId is allowed because the caller has proved who the learner
 * is. Never use this on a public surface; use the (forthcoming) public-rate
 * helpers instead.
 *
 *   1. instructor_learner_notes.custom_hourly_rate_pence  (per-pair)
 *   2. instructors.hourly_rate_pence                       (per-instructor)
 *   3. schools.config.pricing.bulk_hourly_pence            (school default)
 *
 * Zero or NULL at levels 1/2 means "no override at this level" and falls
 * through to the next. learnerId is optional — when omitted, level 1 is
 * skipped (e.g. bulk-credit checkout before a specific learner is targeted).
 *
 * Returns an integer pence/hour. Never throws.
 */
async function getEffectiveHourlyPence(sql, { schoolId, instructorId, learnerId } = {}) {
  const pricing = await getEffectiveHourlyPricing(sql, { schoolId, instructorId, learnerId });
  return pricing.hourlyPence;
}

async function getEffectiveHourlyPricing(sql, { schoolId, instructorId, learnerId } = {}) {
  const sid = parseInt(schoolId) || 1;
  const iid = parseInt(instructorId) || null;
  const lid = parseInt(learnerId)    || null;

  // Level 1: per-learner-pair custom rate (only if both ids present)
  if (iid && lid) {
    const [pair] = await sql`
      SELECT custom_hourly_rate_pence
        FROM instructor_learner_notes
       WHERE instructor_id = ${iid}
         AND learner_id    = ${lid}
         AND school_id     = ${sid}
    `;
    if (pair?.custom_hourly_rate_pence > 0) {
      return { hourlyPence: pair.custom_hourly_rate_pence, source: 'custom_learner_rate' };
    }
  }

  // Level 2: per-instructor rate
  if (iid) {
    const [inst] = await sql`
      SELECT hourly_rate_pence
        FROM instructors
       WHERE id        = ${iid}
         AND school_id = ${sid}
    `;
    if (inst?.hourly_rate_pence > 0) {
      return { hourlyPence: inst.hourly_rate_pence, source: 'instructor_rate' };
    }
  }

  // Level 3: school default
  const { hourlyPence, source } = await getBulkPricing(sql, sid);
  return { hourlyPence, source: source === 'config' ? 'school_default' : source };
}

/**
 * Pence-per-minute variant of getEffectiveHourlyPence. Banker's-rounded so
 * integer-pence callers stay integer.
 */
async function getEffectiveRatePencePerMinute(sql, { schoolId, instructorId, learnerId } = {}) {
  const hourly = await getEffectiveHourlyPence(sql, { schoolId, instructorId, learnerId });
  return Math.round(hourly / 60);
}

/**
 * Direct pay-and-book lesson pricing. This uses the same hourly fallback as
 * credit purchases, but deliberately applies no bulk-package discounts.
 */
async function calcDirectLessonPrice(sql, { schoolId, instructorId, learnerId, durationMinutes } = {}) {
  const minutes = parseInt(durationMinutes, 10) || 0;
  const effective = await getEffectiveHourlyPricing(sql, { schoolId, instructorId, learnerId });
  const pricePence = Math.round(effective.hourlyPence * minutes / 60);
  return {
    pricePence,
    hourlyPence: effective.hourlyPence,
    source: effective.source,
    _source: effective.source,
  };
}

/**
 * Instructor-created offer pricing. Offers snapshot their final per-lesson
 * price at creation time, so later rate changes do not alter pending offers.
 *
 * Explicit offer_price_pence wins, including 0 for free offers. Otherwise the
 * base is effective hourly fallback x duration, with only the offer's own
 * discount_pct applied. Bulk credit tiers are deliberately ignored here.
 */
async function calcOfferLessonPrice(sql, {
  schoolId,
  instructorId,
  learnerId,
  durationMinutes,
  explicitPricePence,
  discountPct,
} = {}) {
  if (explicitPricePence !== undefined && explicitPricePence !== null && explicitPricePence !== '') {
    const explicit = parseInt(explicitPricePence, 10);
    if (Number.isInteger(explicit) && explicit >= 0) {
      return {
        pricePence: explicit,
        basePricePence: explicit,
        discountPct: 0,
        discountAmtPence: 0,
        hourlyPence: null,
        source: 'explicit_offer_price',
        _source: 'explicit_offer_price',
      };
    }
  }

  const minutes = parseInt(durationMinutes, 10) || 0;
  const discount = Number.isFinite(Number(discountPct)) ? Number(discountPct) : 0;
  const effective = await getEffectiveHourlyPricing(sql, { schoolId, instructorId, learnerId });
  const basePricePence = Math.round(effective.hourlyPence * minutes / 60);
  const discountAmtPence = Math.round(basePricePence * discount / 100);
  const pricePence = Math.max(0, basePricePence - discountAmtPence);

  return {
    pricePence,
    basePricePence,
    discountPct: discount,
    discountAmtPence,
    hourlyPence: effective.hourlyPence,
    source: effective.source,
    _source: effective.source,
  };
}

async function getInstructorBulkTiersEnabled(sql, { schoolId, instructorId } = {}) {
  const sid = parseInt(schoolId) || 1;
  const iid = parseInt(instructorId) || null;
  if (!iid) return true;

  const [inst] = await sql`
    SELECT bulk_tiers_enabled
      FROM instructors
     WHERE id = ${iid}
       AND school_id = ${sid}
  `;
  return inst?.bulk_tiers_enabled === true;
}

/**
 * Calculate full pricing breakdown for a bulk-credit purchase.
 * sql + schoolId required so per-school rate + tiers are looked up.
 *
 * Optional 4th arg `{ instructorId, learnerId }` engages the three-level
 * fallback via getEffectiveHourlyPence. When omitted, behaviour is identical
 * to the original school-default-only signature (back-compat for existing
 * api/credits.js callers).
 */
async function calcBulkTotal(sql, schoolId, hours, { instructorId, learnerId } = {}) {
  const useFallback = instructorId != null || learnerId != null;
  let hourlyPence;
  let source;
  let bulkTiersEnabled = true;

  if (useFallback) {
    const effective = await getEffectiveHourlyPricing(sql, { schoolId, instructorId, learnerId });
    hourlyPence = effective.hourlyPence;
    source = effective.source;
    bulkTiersEnabled = await getInstructorBulkTiersEnabled(sql, { schoolId, instructorId });
  } else {
    const bulk = await getBulkPricing(sql, schoolId);
    hourlyPence = bulk.hourlyPence;
    source = bulk.source;
  }

  const { discountTiers } = await getBulkPricing(sql, schoolId);
  const applicableDiscountTiers = bulkTiersEnabled ? discountTiers : [];
  const fullPence = Math.round(hourlyPence * hours);
  const discountPct = getDiscountPct(hours, applicableDiscountTiers);
  const discountAmt = Math.round(fullPence * discountPct / 100);
  return {
    fullPence,
    discountPct,
    discountAmt,
    totalPence: fullPence - discountAmt,
    pricePerHourPence: hourlyPence,
    hourlyPence,
    discountTiers: applicableDiscountTiers,
    schoolDiscountTiers: discountTiers,
    bulkTiersEnabled,
    source,
    rateSource: source,
    _source: source
  };
}

/**
 * Server-side validation for admin save. Returns null if valid, or an error
 * message string if invalid. Used by api/config.js when an admin POSTs new
 * bulk pricing config.
 */
function validateBulkPricingConfig(pricing) {
  if (!pricing || typeof pricing !== 'object') return null; // no pricing block = OK, nothing to validate

  if ('bulk_hourly_pence' in pricing) {
    const v = pricing.bulk_hourly_pence;
    if (!Number.isInteger(v) || v < 1 || v > 50000) {
      return 'bulk_hourly_pence must be an integer between 1 and 50000 (pence). 50000 = £500/hr.';
    }
  }

  if ('bulk_discount_tiers' in pricing) {
    const tiers = pricing.bulk_discount_tiers;
    if (!Array.isArray(tiers)) return 'bulk_discount_tiers must be an array.';
    const seen = new Set();
    for (const t of tiers) {
      if (!t || typeof t !== 'object') return 'Each discount tier must be an object.';
      if (!Number.isInteger(t.min_hours) || t.min_hours < 1 || t.min_hours > MAX_HOURS_PER_PURCHASE) {
        return `Tier min_hours must be an integer between 1 and ${MAX_HOURS_PER_PURCHASE}.`;
      }
      if (!Number.isFinite(t.discount_pct) || t.discount_pct < 0 || t.discount_pct > 50) {
        return 'Tier discount_pct must be a number between 0 and 50.';
      }
      if (seen.has(t.min_hours)) {
        return `Duplicate tier for ${t.min_hours} hours — each milestone must be unique.`;
      }
      seen.add(t.min_hours);
    }
  }

  return null;
}

module.exports = {
  getBulkPricing,
  getDiscountPct,
  calcBulkTotal,
  calcDirectLessonPrice,
  calcOfferLessonPrice,
  getEffectiveHourlyPence,
  getEffectiveHourlyPricing,
  getEffectiveRatePencePerMinute,
  getInstructorBulkTiersEnabled,
  validateBulkPricingConfig,
  MAX_HOURS_PER_PURCHASE,
};
