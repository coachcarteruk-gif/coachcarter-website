const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('admin instructor account access', () => {
  test('admin API exposes school-scoped support access without password mutation', () => {
    const api = read('api/admin.js');
    const access = functionBody(api, 'handleAccessInstructorAccount');

    expect(api).toContain("if (action === 'access-instructor-account') return handleAccessInstructorAccount(req, res);");
    expect(api).toContain('const INSTRUCTOR_ACCESS_MAX_AGE_SEC = 60 * 60 * 2;');
    expect(access).toContain('verifyAdminJWT(req)');
    expect(access).toContain('const schoolId = getAdminSchoolId(admin, req);');
    expect(access).toContain('AND school_id = ${schoolId}');
    expect(access).toContain("if (!instructor.active) return res.status(409).json({ error: 'Instructor account is inactive' });");
    expect(access).toContain('impersonation: true');
    expect(access).toContain('impersonated_by_admin_id: admin.id || null');
    expect(access).toContain('impersonated_by_admin_email: admin.email || null');
    expect(access).toContain('tokenPayload.return_instructor_admin');
    expect(access).toContain('jwt.sign(tokenPayload, secret, { expiresIn: INSTRUCTOR_ACCESS_MAX_AGE_SEC })');
    expect(access).toContain('buildSessionCookie(');
    expect(access).toContain('SESSION_COOKIE_NAMES.instructor');
    expect(access).toContain("action: 'admin.instructor_access_start'");
    expect(access).not.toContain('password_hash');
    expect(access).not.toContain('must_change_password');
  });

  test('admin API clears only instructor support access and audits stop when possible', () => {
    const api = read('api/admin.js');
    const stop = functionBody(api, 'handleStopInstructorAccess');

    expect(api).toContain("if (action === 'stop-instructor-access')    return handleStopInstructorAccess(req, res);");
    expect(stop).toContain('parseCookies(req)');
    expect(stop).toContain('decoded.impersonation === true');
    expect(stop).toContain('if (cookies[SESSION_COOKIE_NAMES.admin] || !instructorPayload)');
    expect(stop).toContain('admin = verifyAdminJWT(req)');
    expect(stop).toContain('if (!admin && !instructorPayload)');
    expect(stop).toContain('return_instructor_admin');
    expect(stop).toContain('restoredToken');
    expect(stop).toContain('buildSessionClearCookie(SESSION_COOKIE_NAMES.instructor)');
    expect(stop).toContain('buildSessionCookie(');
    expect(stop).toContain('buildCsrfCookie(mintCsrfToken())');
    expect(stop).toContain("action: 'admin.instructor_access_stop'");
    expect(stop).not.toContain('buildSessionClearCookie(SESSION_COOKIE_NAMES.admin)');
  });

  test('admin portal starts support access from active instructor rows', () => {
    const portal = read('public/admin/portal.js');

    expect(portal).toContain('data-action="access-instructor-account"');
    expect(portal).toContain('const existingInstructorSession = JSON.parse(localStorage.getItem');
    expect(portal).toContain('return_instructor_admin');
    expect(portal).toContain("fetchAdmin('/api/admin?action=access-instructor-account'");
    expect(portal).toContain('body: JSON.stringify({ instructor_id: id })');
    expect(portal).toContain("localStorage.setItem('cc_instructor'");
    expect(portal).toContain('const impersonation = data.impersonation || { active: true };');
    expect(portal).toContain('if (returnInstructorAdmin) impersonation.return_instructor_admin = returnInstructorAdmin;');
    expect(portal).toContain("window.location.href = '/instructor/dashboard.html';");
    expect(portal).toContain("else if (a === 'access-instructor-account') accessInstructorAccount");
  });

  test('instructor shell shows support access and exits back to admin', () => {
    const auth = read('public/shared/instructor-auth.js');
    const sidebar = read('public/sidebar.js');

    expect(auth).toContain('function isImpersonating(auth)');
    expect(auth).toContain('returnInstructorAdmin');
    expect(auth).toContain("localStorage.setItem(STORAGE_KEY, JSON.stringify({ instructor: returnInstructorAdmin }));");
    expect(auth).toContain("fetchAuthed('/api/admin?action=stop-instructor-access', { method: 'POST' })");
    expect(auth).toContain("window.location.href = '/admin/portal.html';");
    expect(sidebar).toContain('Viewing as admin');
    expect(sidebar).toContain('id="cc-impersonation-exit"');
    expect(sidebar).toContain("isInstructorImpersonation(supportSession)");
    expect(sidebar).toContain("isSupportAccess ? 'Back to Admin' : 'Sign Out'");
    expect(sidebar).toContain('instructor.is_admin && !impersonatingInstructor');
  });
});
