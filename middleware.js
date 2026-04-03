// ── Allowed origins for CORS ──────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://coachcarter.uk',
  'https://www.coachcarter.uk',
  'https://coachcarter.co.uk',
  'https://www.coachcarter.co.uk',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow Vercel preview deployments
  if (origin.endsWith('.vercel.app')) return true;
  // Allow localhost for development
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // ── Maintenance mode ──────────────────────────────────────────────────
  const maintenanceMode = process.env.MAINTENANCE_MODE;

  if (maintenanceMode === 'true') {
    if (url.pathname === '/maintenance.html') {
      return addSecurityHeaders(new Response(null, { headers: { 'x-middleware-next': '1' } }));
    }
    if (url.pathname.startsWith('/api/')) {
      return addSecurityHeaders(new Response(null, { headers: { 'x-middleware-next': '1' } }));
    }
    return new Response(null, {
      status: 307,
      headers: { 'Location': '/maintenance.html' }
    });
  }

  // ── CORS for API routes ───────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');

    // Handle preflight
    if (request.method === 'OPTIONS') {
      const corsHeaders = new Headers();
      if (isAllowedOrigin(origin)) {
        corsHeaders.set('Access-Control-Allow-Origin', origin);
      }
      corsHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      corsHeaders.set('Access-Control-Max-Age', '86400');
      return addSecurityHeaders(new Response(null, { status: 204, headers: corsHeaders }));
    }

    // For actual requests, set CORS origin header
    const response = new Response(null, { headers: { 'x-middleware-next': '1' } });
    if (isAllowedOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    return addSecurityHeaders(response);
  }

  // ── Pass through for non-API routes ───────────────────────────────────
  return addSecurityHeaders(new Response(null, { headers: { 'x-middleware-next': '1' } }));
}

// ── Security headers applied to every response ──────────────────────────
function addSecurityHeaders(response) {
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('X-XSS-Protection', '0');
  return response;
}

export const config = {
  matcher: '/:path*',
};
