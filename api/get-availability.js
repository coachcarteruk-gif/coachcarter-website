const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM availability_submissions';
    let params = [];
    let countQuery = 'SELECT COUNT(*) as total FROM availability_submissions';
    let countParams = [];

    if (status) {
      query += ' WHERE status = $1';
      countQuery += ' WHERE status = $1';
      params.push(status);
      countParams.push(status);
    }

    query += ` ORDER BY submitted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const submissions = await sql(query, params);
    const countResult = await sql(countQuery, countParams);
    const total = parseInt(countResult[0].total);

    res.status(200).json({
      submissions,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) }
    });

  } catch (err) {
    console.error('Error fetching availability:', err);
    res.status(500).json({ error: err.message });
  }
};
