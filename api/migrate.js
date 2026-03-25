const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Protect with a secret
  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!secret || secret !== process.env.MIGRATION_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing migration secret' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migration.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split into individual statements (split on semicolons, respecting $$ blocks)
    const statements = splitStatements(migrationSQL);

    const results = [];
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;

      try {
        await sql(trimmed);
        // Extract a short label from the statement
        const label = trimmed.slice(0, 80).replace(/\s+/g, ' ');
        results.push({ status: 'ok', statement: label });
      } catch (err) {
        results.push({ status: 'error', statement: trimmed.slice(0, 80), error: err.message });
      }
    }

    const errors = results.filter(r => r.status === 'error');
    return res.json({
      success: errors.length === 0,
      total: results.length,
      errors: errors.length,
      results
    });
  } catch (err) {
    console.error('Migration error:', err);
    return res.status(500).json({ error: 'Migration failed', details: err.message });
  }
};

/**
 * Split SQL into statements, respecting DO $$ ... $$ blocks.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip pure comment lines
    if (trimmedLine.startsWith('--') && !inDollarBlock) {
      continue;
    }

    // Detect $$ block boundaries
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount === 1) {
      inDollarBlock = !inDollarBlock;
    } else if (dollarCount >= 2) {
      // Opening and closing on same line (e.g. DO $$ BEGIN ... END $$;)
      // stays outside dollar block
    }

    current += line + '\n';

    // If we hit a semicolon at the end of a line and we're not in a $$ block, split
    if (trimmedLine.endsWith(';') && !inDollarBlock) {
      statements.push(current.trim());
      current = '';
    }
  }

  // Add any remaining content
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}
