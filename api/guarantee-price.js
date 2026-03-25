const { neon } = require('@neondatabase/serverless');

/**
 * GET  /api/guarantee-price  → returns current guarantee pricing state
 * POST /api/guarantee-price  → increments the price (called by webhook after purchase)
 *
 * The guarantee pricing lives in a dedicated DB table so it can be atomically
 * incremented without race conditions on the main config JSON blob.
 *
 * Schema:
 *   guarantee_pricing (
 *     id            INTEGER PRIMARY KEY DEFAULT 1,
 *     base_price    INTEGER NOT NULL DEFAULT 1500,   -- starting price in £
 *     current_price INTEGER NOT NULL DEFAULT 1500,   -- current price in £
 *     increment     INTEGER NOT NULL DEFAULT 100,    -- £ added per purchase
 *     cap           INTEGER NOT NULL DEFAULT 3000,   -- max price in £
 *     purchases     INTEGER NOT NULL DEFAULT 0,      -- total purchases
 *     updated_at    TIMESTAMPTZ DEFAULT NOW()
 *   )
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache for 30s on GET — price doesn't change that often
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  }

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const sql = neon(process.env.POSTGRES_URL);

  // ── GET: return current pricing state ─────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [row] = await sql`SELECT * FROM guarantee_pricing WHERE id = 1`;
      return res.json({
        base_price:    row.base_price,
        current_price: row.current_price,
        increment:     row.increment,
        cap:           row.cap,
        purchases:     row.purchases,
        updated_at:    row.updated_at
      });
    } catch (err) {
      console.error('guarantee-price GET error:', err);
      return res.status(500).json({ error: 'Failed to load guarantee pricing' });
    }
  }

  // ── POST: increment price or manual override ────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { secret, override_price } = req.body || {};

      // Authenticate — only the webhook or admin should call this
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const adminSecret   = process.env.ADMIN_SECRET;
      if (secret !== webhookSecret && secret !== adminSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      let updated;

      if (typeof override_price === 'number' && override_price > 0) {
        // Manual override from admin editor
        [updated] = await sql`
          UPDATE guarantee_pricing
          SET
            current_price = ${override_price},
            updated_at    = NOW()
          WHERE id = 1
          RETURNING *
        `;
        console.log(`✅ Guarantee price manually set → £${updated.current_price}`);
      } else {
        // Atomic increment: current_price = MIN(current_price + increment, cap)
        [updated] = await sql`
          UPDATE guarantee_pricing
          SET
            current_price = LEAST(current_price + increment, cap),
            purchases     = purchases + 1,
            updated_at    = NOW()
          WHERE id = 1
          RETURNING *
        `;
        console.log(`✅ Guarantee price incremented → £${updated.current_price} (purchase #${updated.purchases})`);
      }

      return res.json({
        base_price:    updated.base_price,
        current_price: updated.current_price,
        increment:     updated.increment,
        cap:           updated.cap,
        purchases:     updated.purchases,
        updated_at:    updated.updated_at
      });
    } catch (err) {
      console.error('guarantee-price POST error:', err);
      return res.status(500).json({ error: 'Failed to increment guarantee price' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
