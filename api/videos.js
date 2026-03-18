// Video library API
//
// Public routes (no auth):
//   GET /api/videos?action=list[&category=slug][&learner_only=false]
//     → list published videos, optionally filtered by category
//   GET /api/videos?action=categories
//     → list all categories in sort order
//
// Admin routes (require admin JWT):
//   POST /api/videos?action=create
//   POST /api/videos?action=update
//   POST /api/videos?action=delete
//   POST /api/videos?action=reorder
//   POST /api/videos?action=create-category
//   POST /api/videos?action=update-category
//   POST /api/videos?action=delete-category

const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  try {
    const payload = jwt.verify(auth.slice(7), secret);
    return payload.role === 'admin' || payload.role === 'superadmin';
  } catch { return false; }
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;

  // Public
  if (action === 'list')       return handleList(req, res);
  if (action === 'categories') return handleCategories(req, res);

  // Admin
  if (action === 'create')          return handleCreate(req, res);
  if (action === 'update')          return handleUpdate(req, res);
  if (action === 'delete')          return handleDelete(req, res);
  if (action === 'reorder')         return handleReorder(req, res);
  if (action === 'create-category') return handleCreateCategory(req, res);
  if (action === 'update-category') return handleUpdateCategory(req, res);
  if (action === 'delete-category') return handleDeleteCategory(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── Public: list videos ──────────────────────────────────────────────────────
async function handleList(req, res) {
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const { category, learner_only } = req.query;

    // Build query — no nested sql templates (Neon limitation)
    let videos;
    if (category && category !== 'all') {
      if (learner_only === 'true') {
        videos = await sql`
          SELECT v.id, v.cloudflare_uid, v.title, v.description, v.category_slug,
                 v.thumbnail_url, v.sort_order, v.learner_only,
                 c.label AS category_label, c.color AS category_color
          FROM videos v
          JOIN video_categories c ON c.slug = v.category_slug
          WHERE v.published = true AND v.category_slug = ${category}
          ORDER BY v.sort_order ASC, v.created_at ASC
        `;
      } else {
        videos = await sql`
          SELECT v.id, v.cloudflare_uid, v.title, v.description, v.category_slug,
                 v.thumbnail_url, v.sort_order, v.learner_only,
                 c.label AS category_label, c.color AS category_color
          FROM videos v
          JOIN video_categories c ON c.slug = v.category_slug
          WHERE v.published = true AND v.category_slug = ${category} AND v.learner_only = false
          ORDER BY v.sort_order ASC, v.created_at ASC
        `;
      }
    } else {
      if (learner_only === 'true') {
        videos = await sql`
          SELECT v.id, v.cloudflare_uid, v.title, v.description, v.category_slug,
                 v.thumbnail_url, v.sort_order, v.learner_only,
                 c.label AS category_label, c.color AS category_color
          FROM videos v
          JOIN video_categories c ON c.slug = v.category_slug
          WHERE v.published = true
          ORDER BY c.sort_order ASC, v.sort_order ASC, v.created_at ASC
        `;
      } else {
        videos = await sql`
          SELECT v.id, v.cloudflare_uid, v.title, v.description, v.category_slug,
                 v.thumbnail_url, v.sort_order, v.learner_only,
                 c.label AS category_label, c.color AS category_color
          FROM videos v
          JOIN video_categories c ON c.slug = v.category_slug
          WHERE v.published = true AND v.learner_only = false
          ORDER BY c.sort_order ASC, v.sort_order ASC, v.created_at ASC
        `;
      }
    }

    return res.json({ videos });
  } catch (err) {
    console.error('videos list error:', err);
    return res.status(500).json({ error: 'Failed to load videos', details: err.message });
  }
}

// ── Public: list categories ──────────────────────────────────────────────────
async function handleCategories(req, res) {
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const categories = await sql`
      SELECT slug, label, sort_order, color,
             (SELECT COUNT(*)::int FROM videos v WHERE v.category_slug = c.slug AND v.published = true) AS video_count
      FROM video_categories c
      ORDER BY sort_order ASC
    `;
    return res.json({ categories });
  } catch (err) {
    console.error('categories error:', err);
    return res.status(500).json({ error: 'Failed to load categories' });
  }
}

// ── Admin: create video ──────────────────────────────────────────────────────
async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { cloudflare_uid, title, description, category_slug, thumbnail_url, learner_only } = req.body;
  if (!cloudflare_uid || !title || !category_slug)
    return res.status(400).json({ error: 'cloudflare_uid, title, and category_slug are required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Get next sort order for this category
    const [maxOrder] = await sql`
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
      FROM videos WHERE category_slug = ${category_slug}
    `;

    const [video] = await sql`
      INSERT INTO videos (cloudflare_uid, title, description, category_slug, thumbnail_url, sort_order, learner_only)
      VALUES (${cloudflare_uid}, ${title}, ${description || null}, ${category_slug},
              ${thumbnail_url || null}, ${maxOrder.next_order}, ${learner_only || false})
      RETURNING *
    `;
    return res.status(201).json({ video });
  } catch (err) {
    console.error('video create error:', err);
    return res.status(500).json({ error: 'Failed to create video', details: err.message });
  }
}

// ── Admin: update video ──────────────────────────────────────────────────────
async function handleUpdate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { id, cloudflare_uid, title, description, category_slug, thumbnail_url, published, learner_only } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [video] = await sql`
      UPDATE videos SET
        cloudflare_uid = COALESCE(${cloudflare_uid || null}, cloudflare_uid),
        title          = COALESCE(${title || null}, title),
        description    = COALESCE(${description ?? null}, description),
        category_slug  = COALESCE(${category_slug || null}, category_slug),
        thumbnail_url  = COALESCE(${thumbnail_url ?? null}, thumbnail_url),
        published      = COALESCE(${published !== undefined ? published : null}, published),
        learner_only   = COALESCE(${learner_only !== undefined ? learner_only : null}, learner_only)
      WHERE id = ${id}
      RETURNING *
    `;
    if (!video) return res.status(404).json({ error: 'Video not found' });
    return res.json({ video });
  } catch (err) {
    console.error('video update error:', err);
    return res.status(500).json({ error: 'Failed to update video' });
  }
}

// ── Admin: delete video ──────────────────────────────────────────────────────
async function handleDelete(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    await sql`DELETE FROM videos WHERE id = ${id}`;
    return res.json({ success: true });
  } catch (err) {
    console.error('video delete error:', err);
    return res.status(500).json({ error: 'Failed to delete video' });
  }
}

// ── Admin: reorder videos ────────────────────────────────────────────────────
// Body: { orders: [{ id, sort_order }, ...] }
async function handleReorder(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { orders } = req.body;
  if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders must be an array' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    for (const o of orders) {
      await sql`UPDATE videos SET sort_order = ${o.sort_order} WHERE id = ${o.id}`;
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('video reorder error:', err);
    return res.status(500).json({ error: 'Failed to reorder videos' });
  }
}

// ── Admin: create category ───────────────────────────────────────────────────
async function handleCreateCategory(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { slug, label, color } = req.body;
  if (!slug || !label) return res.status(400).json({ error: 'slug and label are required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [maxOrder] = await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM video_categories`;
    const [cat] = await sql`
      INSERT INTO video_categories (slug, label, sort_order, color)
      VALUES (${slug}, ${label}, ${maxOrder.next_order}, ${color || null})
      RETURNING *
    `;
    return res.status(201).json({ category: cat });
  } catch (err) {
    console.error('category create error:', err);
    return res.status(500).json({ error: 'Failed to create category', details: err.message });
  }
}

// ── Admin: update category ───────────────────────────────────────────────────
async function handleUpdateCategory(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { slug, label, color, sort_order } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [cat] = await sql`
      UPDATE video_categories SET
        label      = COALESCE(${label || null}, label),
        color      = COALESCE(${color ?? null}, color),
        sort_order = COALESCE(${sort_order ?? null}, sort_order)
      WHERE slug = ${slug}
      RETURNING *
    `;
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    return res.json({ category: cat });
  } catch (err) {
    console.error('category update error:', err);
    return res.status(500).json({ error: 'Failed to update category' });
  }
}

// ── Admin: delete category ───────────────────────────────────────────────────
async function handleDeleteCategory(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorised' });

  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    // Check for existing videos
    const [count] = await sql`SELECT COUNT(*)::int AS c FROM videos WHERE category_slug = ${slug}`;
    if (count.c > 0) return res.status(400).json({ error: `Cannot delete category with ${count.c} video(s). Move or delete them first.` });

    await sql`DELETE FROM video_categories WHERE slug = ${slug}`;
    return res.json({ success: true });
  } catch (err) {
    console.error('category delete error:', err);
    return res.status(500).json({ error: 'Failed to delete category' });
  }
}
