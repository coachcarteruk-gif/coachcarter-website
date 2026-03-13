const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Create table if it doesn't exist yet
    await sql`
      CREATE TABLE IF NOT EXISTS site_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        config JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    const rows = await sql`SELECT config, updated_at FROM site_config WHERE id = 1`;

    if (rows.length > 0) {
      // Return config from database
      return res.json({ ...rows[0].config, _source: 'db', _updated: rows[0].updated_at });
    }

    // No DB record yet — fall back to static config.json
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(process.cwd(), 'public', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    return res.json({ ...config, _source: 'file' });

  } catch (err) {
    console.error('get-config error:', err);
    res.status(500).json({ error: 'Failed to load config', details: err.message });
  }
};
