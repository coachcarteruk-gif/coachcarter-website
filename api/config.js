const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_slack');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── GET: return current config ──────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const sql = neon(process.env.POSTGRES_URL);

      await sql`
        CREATE TABLE IF NOT EXISTS site_config (
          id INTEGER PRIMARY KEY DEFAULT 1,
          config JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      const rows = await sql`SELECT config, updated_at FROM site_config WHERE id = 1`;

      if (rows.length > 0) {
        return res.json({ ...rows[0].config, _source: 'db', _updated: rows[0].updated_at });
      }

      // No DB record yet — fall back to static config.json
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(process.cwd(), 'public', 'config.json');
      const raw = fs.readFileSync(configPath, 'utf8');
      return res.json({ ...JSON.parse(raw), _source: 'file' });

    } catch (err) {
      console.error('config GET error:', err);
      reportError('/api/config', err);
      return res.status(500).json({ error: 'Failed to load config', details: err.message });
    }
  }

  // ── POST: save config ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { config, password } = req.body;

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

      const { _source, _updated, ...cleanConfig } = config;
      cleanConfig.last_updated = new Date().toISOString();

      const sql = neon(process.env.POSTGRES_URL);

      await sql`
        CREATE TABLE IF NOT EXISTS site_config (
          id INTEGER PRIMARY KEY DEFAULT 1,
          config JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      await sql`
        INSERT INTO site_config (id, config, updated_at)
        VALUES (1, ${JSON.stringify(cleanConfig)}, NOW())
        ON CONFLICT (id) DO UPDATE
          SET config = EXCLUDED.config,
              updated_at = NOW()
      `;

      return res.json({ success: true, updated_at: new Date().toISOString() });

    } catch (err) {
      console.error('config POST error:', err);
      reportError('/api/config', err);
      return res.status(500).json({ error: 'Failed to save config', details: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
