const { neon } = require('@neondatabase/serverless');
const { safeEqual } = require('./_auth');
const { reportError } = require('./_error-alert');

// Narrow, idempotent production migration for instructor-specific learner
// archiving. This avoids replaying the full aggregate migration just to add
// one nullable relationship column and its partial lookup index.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!safeEqual(secret, process.env.MIGRATION_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing migration secret' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    await sql`
      ALTER TABLE instructor_learner_notes
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_archived
      ON instructor_learner_notes(instructor_id, school_id, learner_id)
      WHERE archived_at IS NOT NULL
    `;

    const [verification] = await sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'instructor_learner_notes'
            AND column_name = 'archived_at'
        ) AS column_exists,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_instructor_learner_notes_archived'
        ) AS index_exists
    `;

    const success = verification?.column_exists === true && verification?.index_exists === true;
    return res.status(success ? 200 : 500).json({
      success,
      column_exists: verification?.column_exists === true,
      index_exists: verification?.index_exists === true,
    });
  } catch (err) {
    console.error('instructor learner archive migration error:', err);
    reportError('/api/migrate-instructor-learner-archive', err);
    return res.status(500).json({ error: 'Migration failed', details: 'Internal server error' });
  }
};
