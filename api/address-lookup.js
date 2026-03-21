const jwt = require('jsonwebtoken');

function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const postcode = (req.query.postcode || '').trim().replace(/\s+/g, '');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i.test(postcode)) {
    return res.status(400).json({ error: 'Invalid postcode format' });
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
    return res.status(502).json({ error: 'Postcode lookup temporarily unavailable' });
  }
};
