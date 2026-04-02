// Travel time check between pickup postcodes
//
// Two modes:
// 1. FAST (slot filtering): postcodes.io + haversine distance estimation
//    Used by handleAvailable() to hide infeasible slots. No API key needed.
// 2. PRECISE (booking warning): OpenRouteService driving directions
//    Used by handleBook() for post-booking warnings. Needs ORS API key.

const DEFAULT_MAX_TRAVEL_MINUTES = 30;
const TRAVEL_BUFFER_MINUTES = 10; // extra buffer on top of estimated drive time

// UK postcode regex — matches full postcodes like "SW1A 1AA" or "B1 1BB"
const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

/** Extract a UK postcode from a free-text address string */
function extractPostcode(address) {
  if (!address) return null;
  const match = address.match(UK_POSTCODE_RE);
  return match ? match[1].toUpperCase().replace(/\s+/g, ' ') : null;
}

// ── Fast estimation (postcodes.io + haversine) ─────────────────────────────
// Used for slot filtering — no API key needed, no rate limits

/** Bulk geocode UK postcodes via postcodes.io (free, up to 100 per call) */
async function bulkGeocodeUK(postcodes) {
  if (!postcodes || postcodes.length === 0) return {};
  const unique = [...new Set(postcodes.map(p => p.replace(/\s+/g, ' ').toUpperCase()))];
  const map = {};
  try {
    // postcodes.io accepts up to 100 postcodes per bulk request
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const resp = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch })
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const item of (data.result || [])) {
        if (item.result) {
          map[item.query.toUpperCase().replace(/\s+/g, ' ')] = {
            lat: item.result.latitude,
            lon: item.result.longitude
          };
        }
      }
    }
  } catch { /* graceful — return whatever we got */ }
  return map;
}

/** Haversine distance in km between two lat/lon points */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate driving time in minutes from straight-line distance.
 * Uses road winding factor (1.3) and average UK urban speed (30 mph / 48 km/h).
 */
function estimateDriveMinutes(lat1, lon1, lat2, lon2) {
  const straightKm = haversineKm(lat1, lon1, lat2, lon2);
  const roadKm = straightKm * 1.3;
  const avgSpeedKmH = 48;
  return Math.round((roadKm / avgSpeedKmH) * 60);
}

// ── Precise routing (OpenRouteService) ──────────────────────────────────────
// Used for post-booking warnings — needs OPENROUTESERVICE_API_KEY

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

module.exports = {
  checkTravelTime, checkAdjacentTravelTime, extractPostcode,
  bulkGeocodeUK, estimateDriveMinutes, TRAVEL_BUFFER_MINUTES, DEFAULT_MAX_TRAVEL_MINUTES
};
