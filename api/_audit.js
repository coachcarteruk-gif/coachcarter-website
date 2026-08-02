/* ─── GDPR Audit Logging ──────────────────────────────────────────────────── */

async function writeAudit(sql, { adminId, adminEmail, action, targetType, targetId, details, schoolId, req }) {
  const ip = (req && req.headers && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  await sql`INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, details, ip_address, school_id)
    VALUES (${adminId}, ${adminEmail || null}, ${action}, ${targetType || null}, ${targetId || null}, ${JSON.stringify(details || {})}, ${ip}, ${schoolId})`;
}

async function logAudit(sql, entry) {
  try {
    await writeAudit(sql, entry);
  } catch (err) {
    console.error('audit log error:', err.message);
  }
}

// Security-sensitive paths can require the audit row before proceeding. The
// caller intentionally receives any database error and must fail closed.
async function logAuditRequired(sql, entry) {
  return writeAudit(sql, entry);
}

module.exports = { logAudit, logAuditRequired };
