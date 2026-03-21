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

  const apiKey = process.env.GETADDRESS_API_KEY;
  if (!apiKey) {
    console.error('GETADDRESS_API_KEY not configured');
    return res.status(503).json({ error: 'Address lookup not available' });
  }

  try {
    const url = `https://api.getaddress.io/find/${encodeURIComponent(postcode)}?api-key=${apiKey}&expand=true`;
    const resp = await fetch(url);

    if (resp.status === 404) {
      return res.status(404).json({ error: 'No addresses found for this postcode' });
    }
    if (resp.status === 429) {
      return res.status(429).json({ error: 'Lookup limit reached, please try again later' });
    }
    if (!resp.ok) {
      return res.status(502).json({ error: 'Address lookup temporarily unavailable' });
    }

    const data = await resp.json();
    const addresses = (data.addresses || []).map(a => {
      // getaddress.io with expand=true returns objects; format them as strings
      if (typeof a === 'string') return a.replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
      const parts = [a.line_1, a.line_2, a.line_3, a.line_4, a.locality, a.town_or_city, a.county].filter(Boolean);
      return parts.join(', ');
    }).filter(Boolean);

    return res.json({ postcode: data.postcode || postcode, addresses });
  } catch (err) {
    console.error('address-lookup error:', err);
    return res.status(502).json({ error: 'Address lookup temporarily unavailable' });
  }
};
