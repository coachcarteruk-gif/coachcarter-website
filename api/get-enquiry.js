const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Add your auth check here if you have one
  
  const { id } = req.query;
  
  if (!id) {
    res.status(400).json({ error: 'ID required' });
    return;
  }
  
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [enquiry] = await sql`SELECT * FROM enquiries WHERE id = ${id}`;
    
    if (!enquiry) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    
    res.json({ enquiry });
  } catch (err) {
    console.error('Error loading enquiry:', err);
    res.status(500).json({ error: 'Failed to load enquiry' });
  }
};
