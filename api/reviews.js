const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function refreshReviewsFromGoogle(sql) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    console.warn('Google Places API key or Place ID not configured');
    return;
  }

  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews'
    }
  });

  if (!response.ok) {
    console.error('Google Places API error:', response.status, await response.text());
    return;
  }

  const data = await response.json();
  const reviews = data.reviews || [];

  await sql`DELETE FROM google_reviews`;

  for (const review of reviews) {
    const reviewId = `${review.authorAttribution?.displayName || 'anon'}_${review.publishTime || ''}`;

    await sql`
      INSERT INTO google_reviews (review_id, author_name, rating, text, relative_time, publish_time, profile_photo_url)
      VALUES (
        ${reviewId},
        ${review.authorAttribution?.displayName || 'Anonymous'},
        ${review.rating || 5},
        ${review.text?.text || ''},
        ${review.relativePublishTimeDescription || ''},
        ${review.publishTime || null},
        ${review.authorAttribution?.photoUri || null}
      )
      ON CONFLICT (review_id) DO UPDATE SET
        text = EXCLUDED.text,
        rating = EXCLUDED.rating,
        relative_time = EXCLUDED.relative_time,
        cached_at = NOW()
    `;
  }

  await sql`
    INSERT INTO google_reviews_meta (id, last_fetched_at, place_id, place_name, overall_rating, total_reviews)
    VALUES (
      1,
      NOW(),
      ${placeId},
      ${data.displayName?.text || null},
      ${data.rating || null},
      ${data.userRatingCount || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      last_fetched_at = NOW(),
      place_name = EXCLUDED.place_name,
      overall_rating = EXCLUDED.overall_rating,
      total_reviews = EXCLUDED.total_reviews
  `;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const sql = neon(process.env.POSTGRES_URL);

  // ── GET: return cached reviews ────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      // Ensure tables exist
      await sql`
        CREATE TABLE IF NOT EXISTS google_reviews (
          id SERIAL PRIMARY KEY, review_id TEXT UNIQUE NOT NULL,
          author_name TEXT NOT NULL, rating SMALLINT NOT NULL,
          text TEXT, relative_time TEXT, publish_time TIMESTAMPTZ,
          profile_photo_url TEXT, cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS google_reviews_meta (
          id INTEGER PRIMARY KEY DEFAULT 1, last_fetched_at TIMESTAMPTZ,
          place_id TEXT, place_name TEXT, overall_rating NUMERIC(2,1), total_reviews INTEGER
        )
      `;

      // Check if cache is stale
      const [meta] = await sql`SELECT last_fetched_at FROM google_reviews_meta WHERE id = 1`;
      const lastFetched = meta?.last_fetched_at ? new Date(meta.last_fetched_at) : null;
      const isStale = !lastFetched || (Date.now() - lastFetched.getTime()) > CACHE_MAX_AGE_MS;

      if (isStale) {
        try {
          await refreshReviewsFromGoogle(sql);
        } catch (err) {
          console.error('Failed to refresh Google reviews:', err);
          // Serve stale cache instead of failing
        }
      }

      const reviews = await sql`
        SELECT author_name, rating, text, relative_time, publish_time, profile_photo_url
        FROM google_reviews
        ORDER BY publish_time DESC NULLS LAST
      `;

      const [metaRow] = await sql`
        SELECT overall_rating, total_reviews, place_name
        FROM google_reviews_meta WHERE id = 1
      `;

      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.json({
        reviews,
        overall_rating: metaRow?.overall_rating || null,
        total_reviews: metaRow?.total_reviews || null,
        place_name: metaRow?.place_name || null
      });

    } catch (err) {
      console.error('reviews GET error:', err);
      reportError('/api/reviews', err);
      return res.status(500).json({ error: 'Failed to load reviews', details: err.message });
    }
  }

  // ── POST: force refresh (admin only) ──────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { password } = req.body;
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret) {
        return res.status(500).json({ error: 'ADMIN_SECRET environment variable not set' });
      }
      if (password !== adminSecret) {
        return res.status(401).json({ error: 'Incorrect password' });
      }

      await refreshReviewsFromGoogle(sql);
      return res.json({ success: true, message: 'Reviews refreshed' });

    } catch (err) {
      console.error('reviews POST error:', err);
      reportError('/api/reviews', err);
      return res.status(500).json({ error: 'Failed to refresh reviews', details: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
