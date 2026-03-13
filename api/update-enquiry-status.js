const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Add your auth check here if you have one
  
  const { id, status } = req.body;
  
  if (!id || !status) {
    res.status(400).json({ error: 'ID and status required' });
    return;
  }
  
  try {
    const sql = neon(process.env.POSTGRES_URL);
    await sql`UPDATE enquiries SET status = ${status} WHERE id = ${id}`;
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating enquiry:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
};
