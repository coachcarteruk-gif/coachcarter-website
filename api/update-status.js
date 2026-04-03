const { neon } = require('@neondatabase/serverless');
const jwt      = require('jsonwebtoken');
const { reportError } = require('./_error-alert');

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      if (decoded.role === 'admin' || decoded.role === 'superadmin') return true;
      if (decoded.role === 'instructor' && decoded.isAdmin === true) return true;
    } catch {}
  }
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const provided = req.body?.admin_secret || req.headers['x-admin-secret'];
  return provided === secret;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
    'Content-Type, Authorization, X-Admin-Secret');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Require admin auth
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorised — admin access required' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const { id, status } = req.body;

    if (!id || !status) {
      return res.status(400).json({ error: 'Missing id or status' });
    }

    const result = await sql`
      UPDATE availability_submissions SET status = ${status} WHERE id = ${id} RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.status(200).json({ success: true, submission: result[0] });
  } catch (error) {
    console.error('Error updating status:', error);
    reportError('/api/update-status', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
};
