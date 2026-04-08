const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { requireAuth } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Require admin auth
  const admin = requireAuth(req, { roles: ['admin'] });
  if (!admin) {
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
