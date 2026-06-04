// Seed/reset Codex test accounts against POSTGRES_URL_TEST only.
//
// GET /api/seed-test-data?secret=MIGRATION_SECRET
// GET /api/seed-test-data?secret=MIGRATION_SECRET&action=clean

const { safeEqual } = require('./_auth');
const { seedCodexTestData } = require('./_codex-test-data');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!safeEqual(secret, process.env.MIGRATION_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing secret' });
  }

  const action = req.query.action === 'clean' ? 'clean' : 'reset';

  try {
    const results = await seedCodexTestData({ action });
    return res.json({
      ok: true,
      message: action === 'clean'
        ? 'Codex test data cleaned from POSTGRES_URL_TEST.'
        : 'Codex test accounts reset in POSTGRES_URL_TEST.',
      results,
    });
  } catch (err) {
    console.error('seed-test-data error:', err);
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: 'Failed to seed Codex test data',
      message: err.message || 'Internal server error',
    });
  }
};
