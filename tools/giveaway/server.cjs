// Local-only review prototype. Never import this server into Vercel routes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService, InputError } = require('./domain.cjs');
// Isolated auth key: never read a live environment file or use a production key.
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
const jwt = require('jsonwebtoken');
const { requireAuth, getSchoolId } = require('../../api/_auth');
const { resolveSchoolFromRequest } = require('../../api/_tenant');
const { parseCookies } = require('../../api/_csrf');
const statePath = path.resolve(__dirname, '../../tmp/' + (process.env.GIVEAWAY_TEST_RUN === 'true' ? 'giveaway-test-' + process.pid : 'giveaway-preview') + '-state.json');
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const empty = () => ({ nominations: [], outbox: [], consents: [], emails: [] });
const store = {
  data: fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : empty(),
  async save() { fs.writeFileSync(statePath + '.new', JSON.stringify(this.data, null, 2)); fs.renameSync(statePath + '.new', statePath); },
};
const service = createService(store);
const sessions = new Map(), limits = new Map();
let serial = Promise.resolve();
function rate(key, max) { const t = Date.now(); let row = limits.get(key); if (!row || row.until < t) { row = { count: 0, until: t + 3600000 }; limits.set(key, row); } if (++row.count > max) throw new InputError({}, 429, 'Too many attempts. Please try again later.'); }
async function capture(item) {
  // Stable outbox ID makes capture retries idempotent, including a restarted process.
  if (!store.data.emails.some(e => e.id === item.id)) store.data.emails.push({ id: item.id, school_id: item.school_id, token: item.token, recipient: item.recipient });
}
async function seed() {
  if (store.data.nominations.length) return;
  await service.nominate(1, { submission_key: crypto.randomUUID(), nominee_name: 'Alex Taylor', nominee_phone: '07700900123', nominee_email: 'alex.taylor@example.test', nominator_name: 'Jamie Morgan', nominator_phone: '07700900456', nominator_email: 'jamie.morgan@example.test', reason: 'Alex always shows up for other people. Being able to drive would make getting to work and helping family so much easier. I would love to see them have this opportunity.', permission: true });
  await service.deliver(capture);
}
const routes = { '/': 'index.html', '/apply': 'apply.html', '/review': 'review.html', '/privacy': 'privacy.html', '/style.css': 'style.css', '/app.js': 'app.js', '/review.js': 'review.js' };
const fonts = { '/assets/heading.ttf': 'Bricolage.ttf', '/assets/body.ttf': 'Lato-Regular.ttf' };
function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  const allowedHost = '127.0.0.1:' + server.address().port;
  if (req.headers.host !== allowedHost) return send(res, 403, { message: 'Local preview only.' });
  const url = new URL(req.url, 'http://' + allowedHost);
  if (url.pathname !== '/api/giveaway') {
    const filename = routes[url.pathname] ? path.join(__dirname, 'public', routes[url.pathname]) : fonts[url.pathname] ? path.resolve(__dirname, '../../docs/payout/fonts', fonts[url.pathname]) : null;
    if (!filename) return send(res, 404, { message: 'Page not found.' });
    const ext = path.extname(filename); res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf' })[ext]); return fs.createReadStream(filename).pipe(res);
  }
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { message: 'Method not allowed.' });
  if (req.method === 'POST' && (req.headers.origin !== 'http://' + allowedHost || !String(req.headers['content-type']).startsWith('application/json'))) return send(res, 403, { message: 'Open the form in this local preview.' });
  try {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new InputError({}, 413, 'This submission is too large.'); }
    const body = raw ? JSON.parse(raw) : {}, action = url.searchParams.get('action');
    if (action !== 'review' && req.method !== 'POST') throw new InputError({}, 405, 'Method not allowed.');
    req.query = {}; const tenant = await resolveSchoolFromRequest(req, { sql: async () => [] });
    if (!tenant) throw new InputError({}, 404, 'School not found.');
    const schoolId = tenant.schoolId, cookies = parseCookies(req);
    const task = async () => {
      const before = structuredClone(store.data);
      try {
        if (action === 'config') return service.config();
        if (action === 'preview-login') {
          const token = jwt.sign({ id: 999999, role: 'admin', isAdmin: true, school_id: 1 }, process.env.JWT_SECRET, { expiresIn: '12h' });
          res.setHeader('Set-Cookie', 'giveaway_preview_admin=' + token + '; HttpOnly; SameSite=Strict; Path=/api/giveaway; Max-Age=43200'); return { ok: true };
        }
        if (action === 'review') {
          if (req.method !== 'GET') throw new InputError({}, 405, 'Method not allowed.');
          const authReq = { ...req, method: 'GET', headers: { ...req.headers, cookie: 'cc_admin=' + (cookies.giveaway_preview_admin || '') } };
          const admin = requireAuth(authReq, { roles: ['admin'] });
          if (!admin) throw new InputError({}, 401, 'Open the fictional review session to continue.');
          const scope = getSchoolId(admin, { query: {} });
          return { ok: true, records: service.review(scope), emails: store.data.emails.filter(e => e.school_id === scope) };
        }
        if (action === 'nominate') { rate('nominate:' + req.socket.remoteAddress, 25); const result = await service.nominate(schoolId, body); await service.deliver(capture); return result; }
        let token;
        const session = sessions.get(cookies.giveaway_invitation);
        if (session && session.until > Date.now() && session.schoolId === schoolId) token = session.token;
        if (action === 'invitation' && body.token) {
          rate('link:' + req.socket.remoteAddress, 100);
          if (!/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw new InputError({}, 404, 'This invitation is unavailable. Please use the full link in your email.');
          const result = service.inspect(schoolId, body.token);
          const sessionId = crypto.randomBytes(32).toString('base64url'); sessions.set(sessionId, { token: body.token, schoolId, until: Date.now() + 43200000 });
          res.setHeader('Set-Cookie', 'giveaway_invitation=' + sessionId + '; HttpOnly; SameSite=Strict; Path=/api/giveaway; Max-Age=43200'); return result;
        }
        if (action === 'invitation') return service.inspect(schoolId, token);
        if (action === 'apply') return await service.apply(schoolId, token, body);
        if (action === 'withdraw') return await service.withdraw(schoolId, token);
        throw new InputError({}, 404, 'Page not found.');
      } catch (error) { store.data = before; throw error; }
    };
    // Serialize the local JSON store. This is deliberately NOT a production database adapter.
    const pending = serial.then(task); serial = pending.catch(() => {});
    send(res, 200, await pending);
  } catch (error) { send(res, error.status || 500, { error: true, message: error instanceof InputError ? error.message : 'We couldn’t save that right now. Please try again.', fields: error.fields || {} }); }
});
seed().then(() => server.listen(Number(process.env.GIVEAWAY_PREVIEW_PORT || 0), '127.0.0.1', () => {
  const origin = 'http://127.0.0.1:' + server.address().port;
  if (process.env.GIVEAWAY_TEST_RUN !== 'true') fs.writeFileSync(path.resolve(__dirname, '../../tmp/giveaway-preview-url.txt'), origin);
  console.log('Giveaway preview: ' + origin + '\nReview desk: ' + origin + '/review\nLocal fictional data only. No live messages or database connections.');
})).catch(() => { console.error('Preview could not start. Check the fictional state file and local deadline.'); process.exitCode = 1; });
