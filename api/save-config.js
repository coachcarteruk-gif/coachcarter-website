const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { config, password } = req.body;

    // Password check against environment variable
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(500).json({ error: 'ADMIN_SECRET environment variable not set' });
    }
    if (password !== adminSecret) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Invalid config payload' });
    }

    // Strip any internal meta fields before saving
    const { _source, _updated, ...cleanConfig } = config;
    cleanConfig.last_updated = new Date().toISOString();

    const sql = neon(process.env.POSTGRES_URL);

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS site_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        config JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Upsert — always updates the single config row
    await sql`
      INSERT INTO site_config (id, config, updated_at)
      VALUES (1, ${JSON.stringify(cleanConfig)}, NOW())
      ON CONFLICT (id) DO UPDATE
        SET config = EXCLUDED.config,
            updated_at = NOW()
    `;

    res.json({ success: true, updated_at: new Date().toISOString() });

  } catch (err) {
    console.error('save-config error:', err);
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
};
