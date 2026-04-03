/* ─── GDPR Audit Logging ──────────────────────────────────────────────────── */

async function logAudit(sql, { adminId, adminEmail, action, targetType, targetId, details, schoolId, req }) {
  try {
    const ip = (req && req.headers && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    await sql`INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, details, ip_address, school_id)
      VALUES (${adminId}, ${adminEmail || null}, ${action}, ${targetType || null}, ${targetId || null}, ${JSON.stringify(details || {})}, ${ip}, ${schoolId})`;
  } catch (err) {
    console.error('audit log error:', err.message);
  }
}

module.exports = { logAudit };
