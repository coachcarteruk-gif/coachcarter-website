const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');

module.exports = async (req, res) => {
  // ── GET: return current config ──────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const sql = neon(process.env.POSTGRES_URL);
      const schoolId = parseInt(req.query.school_id) || 1;

      // Try school-specific config from the schools table first
      const schoolRows = await sql`SELECT config, updated_at FROM schools WHERE id = ${schoolId}`;
      if (schoolRows.length > 0 && schoolRows[0].config) {
        return res.json({ ...schoolRows[0].config, _source: 'school', _school_id: schoolId, _updated: schoolRows[0].updated_at });
      }

      // Fall back to legacy site_config table
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
      return res.status(500).json({ error: 'Failed to load config', details: 'Internal server error' });
    }
  }

  // ── POST: record cookie consent (GDPR) ──────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'record-consent') {
    try {
      const { visitor_id, analytics, learner_id } = req.body;
      if (!visitor_id) return res.status(400).json({ error: 'visitor_id required' });
      const crypto = require('crypto');
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : null;
      const sql = neon(process.env.POSTGRES_URL);
      const schoolId = parseInt(req.body.school_id) || 1;
      await sql`INSERT INTO cookie_consents (visitor_id, learner_id, analytics, ip_hash, user_agent, school_id)
        VALUES (${visitor_id}, ${learner_id || null}, ${!!analytics}, ${ipHash}, ${(req.headers['user-agent'] || '').slice(0, 255)}, ${schoolId})`;
      return res.json({ ok: true });
    } catch (err) {
      console.error('record-consent error:', err);
      return res.status(500).json({ error: 'Failed to record consent' });
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

      const { _source, _updated, _school_id, ...cleanConfig } = config;
      cleanConfig.last_updated = new Date().toISOString();
      const schoolId = parseInt(req.body.school_id) || 1;

      const sql = neon(process.env.POSTGRES_URL);

      // Save to school-specific config if school_id provided
      if (schoolId > 1 || _source === 'school') {
        await sql`
          UPDATE schools SET config = ${JSON.stringify(cleanConfig)}, updated_at = NOW()
          WHERE id = ${schoolId}
        `;
      } else {
        await sql`
          INSERT INTO site_config (id, config, updated_at)
          VALUES (1, ${JSON.stringify(cleanConfig)}, NOW())
          ON CONFLICT (id) DO UPDATE
            SET config = EXCLUDED.config,
                updated_at = NOW()
        `;
      }

      return res.json({ success: true, updated_at: new Date().toISOString() });

    } catch (err) {
      console.error('config POST error:', err);
      reportError('/api/config', err);
      return res.status(500).json({ error: 'Failed to save config', details: 'Internal server error' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
