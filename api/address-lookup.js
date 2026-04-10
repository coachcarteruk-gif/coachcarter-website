const { requireAuth } = require('./_auth');
const { reportError } = require('./_error-alert');
const { neon } = require('@neondatabase/serverless');
const { checkRateLimit } = require('./_rate-limit');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAuth(req, { roles: ['learner', 'instructor', 'admin'] });
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const postcode = (req.query.postcode || '').trim().replace(/\s+/g, '');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i.test(postcode)) {
    return res.status(400).json({ error: 'Invalid postcode format' });
  }

  // Rate limit: 60/hour per authenticated user. Postcodes.io is free but we
  // proxy it, so a runaway client could generate meaningful outbound traffic.
  // Keyed per user.id (not IP) to survive NAT and bill the right identity.
  const sql = neon(process.env.POSTGRES_URL);
  const rl = await checkRateLimit(sql, {
    key: `address_lookup:${user.id}`,
    max: 60,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many address lookups. Please try again later.' });
  }

  try {
    // Use postcodes.io (free, no API key needed) to validate and get area info
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
    const resp = await fetch(url);

    if (resp.status === 404) {
      return res.status(404).json({ error: 'Postcode not found' });
    }
    if (!resp.ok) {
      return res.status(502).json({ error: 'Postcode lookup temporarily unavailable' });
    }

    const data = await resp.json();
    const r = data.result;

    return res.json({
      postcode: r.postcode,
      area: [r.parish, r.admin_ward, r.admin_district].filter(Boolean).join(', '),
      town: r.admin_district || '',
      county: r.pfa || r.admin_county || '',
      country: r.country || 'England'
    });
  } catch (err) {
    console.error('address-lookup error:', err);
    reportError('/api/address-lookup', err);
    return res.status(502).json({ error: 'Postcode lookup temporarily unavailable' });
  }
};
