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
 * Per-learner custom rates (instructor_learner_notes.custom_hourly_rate_pence)
 * deliberately do NOT apply to bulk credits — credits are paid up-front into a
 * balance, not tied to a specific instructor at purchase time. Custom rates
 * still apply at slot-booking time inside api/slots.js.
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
 * Calculate full pricing breakdown for a bulk-credit purchase.
 * sql + schoolId required so per-school rate + tiers are looked up.
 */
async function calcBulkTotal(sql, schoolId, hours) {
  const { hourlyPence, discountTiers, source } = await getBulkPricing(sql, schoolId);
  const fullPence = Math.round(hourlyPence * hours);
  const discountPct = getDiscountPct(hours, discountTiers);
  const discountAmt = Math.round(fullPence * discountPct / 100);
  return {
    fullPence,
    discountPct,
    discountAmt,
    totalPence: fullPence - discountAmt,
    pricePerHourPence: hourlyPence,
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
  validateBulkPricingConfig,
  MAX_HOURS_PER_PURCHASE,
};
