// Travel time check between pickup postcodes
//
// Uses OpenRouteService (free tier, 40 req/min) to estimate driving time
// between two UK postcodes. Returns null gracefully if postcodes can't be
// extracted or the API is unavailable.

const DEFAULT_MAX_TRAVEL_MINUTES = 30;

// UK postcode regex — matches full postcodes like "SW1A 1AA" or "B1 1BB"
const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

/** Extract a UK postcode from a free-text address string */
function extractPostcode(address) {
  if (!address) return null;
  const match = address.match(UK_POSTCODE_RE);
  return match ? match[1].toUpperCase().replace(/\s+/g, ' ') : null;
}

/** Geocode a UK postcode to [lon, lat] using OpenRouteService */
async function geocodePostcode(apiKey, postcode) {
  const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(postcode + ', UK')}&boundary.country=GB&size=1`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const coords = data.features?.[0]?.geometry?.coordinates; // [lon, lat]
  return coords || null;
}

/** Get driving time in minutes between two [lon, lat] coordinate pairs */
async function getDrivingMinutes(apiKey, from, to) {
  const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${from[0]},${from[1]}&end=${to[0]},${to[1]}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  const seconds = data.features?.[0]?.properties?.summary?.duration;
  return seconds ? Math.round(seconds / 60) : null;
}

/**
 * Check travel time between two pickup addresses.
 *
 * @param {string} addressA - First pickup address (free text)
 * @param {string} addressB - Second pickup address (free text)
 * @param {number} [maxMinutes] - Threshold in minutes (default 30)
 * @returns {Promise<{travelMinutes: number, exceeds: boolean, warning: string}|null>}
 *   Returns null if postcodes can't be extracted or API is unavailable.
 */
async function checkTravelTime(addressA, addressB, maxMinutes) {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) return null;

  const postcodeA = extractPostcode(addressA);
  const postcodeB = extractPostcode(addressB);
  if (!postcodeA || !postcodeB) return null;

  // Same postcode — no travel time issue
  if (postcodeA.replace(/\s/g, '') === postcodeB.replace(/\s/g, '')) {
    return { travelMinutes: 0, exceeds: false, warning: null };
  }

  try {
    const [coordsA, coordsB] = await Promise.all([
      geocodePostcode(apiKey, postcodeA),
      geocodePostcode(apiKey, postcodeB)
    ]);

    if (!coordsA || !coordsB) return null;

    const travelMinutes = await getDrivingMinutes(apiKey, coordsA, coordsB);
    if (travelMinutes === null) return null;

    const threshold = maxMinutes || DEFAULT_MAX_TRAVEL_MINUTES;
    const exceeds = travelMinutes > threshold;

    return {
      travelMinutes,
      exceeds,
      warning: exceeds
        ? `Travel time between pickups is ~${travelMinutes} mins (threshold: ${threshold} mins)`
        : null
    };
  } catch {
    // API errors should never block bookings
    return null;
  }
}

/**
 * Find adjacent bookings and check travel time against a new booking's pickup address.
 *
 * @param {Function} sql - Neon SQL tagged template
 * @param {number} instructorId
 * @param {string} date - YYYY-MM-DD
 * @param {string} startTime - HH:MM:SS
 * @param {string} endTime - HH:MM:SS
 * @param {string} pickupAddress - New booking's pickup address
 * @param {number} [maxMinutes] - Override threshold
 * @returns {Promise<{warnings: string[]}|null>}
 */
async function checkAdjacentTravelTime(sql, instructorId, date, startTime, endTime, pickupAddress, maxMinutes) {
  if (!pickupAddress) return null;
  if (!process.env.OPENROUTESERVICE_API_KEY) return null;

  // Get all confirmed bookings for this instructor on this date that have addresses
  const bookings = await sql`
    SELECT id, pickup_address, start_time::text AS start_time, end_time::text AS end_time
    FROM lesson_bookings
    WHERE instructor_id = ${instructorId}
      AND scheduled_date = ${date}
      AND status = 'confirmed'
      AND pickup_address IS NOT NULL
    ORDER BY start_time
  `;

  if (bookings.length === 0) return null;

  // Find the booking immediately before and after the new slot
  let before = null;
  let after = null;

  for (const b of bookings) {
    if (b.end_time <= startTime) {
      before = b; // keep updating — we want the closest one before
    }
    if (b.start_time >= endTime && !after) {
      after = b; // first one after
    }
  }

  const warnings = [];

  // Check travel from previous booking's pickup to new booking's pickup
  if (before) {
    const result = await checkTravelTime(before.pickup_address, pickupAddress, maxMinutes);
    if (result?.exceeds) {
      warnings.push(result.warning);
    }
  }

  // Check travel from new booking's pickup to next booking's pickup
  if (after) {
    const result = await checkTravelTime(pickupAddress, after.pickup_address, maxMinutes);
    if (result?.exceeds) {
      warnings.push(result.warning);
    }
  }

  return warnings.length > 0 ? { warnings } : null;
}

module.exports = { checkTravelTime, checkAdjacentTravelTime, extractPostcode };
