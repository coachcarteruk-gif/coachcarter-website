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
        corsHeaders.set('Access-Control-Allow-Credentials', 'true');
      }
      corsHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token');
      corsHeaders.set('Access-Control-Max-Age', '86400');
      return addSecurityHeaders(new Response(null, { status: 204, headers: corsHeaders }));
    }

    // For actual requests, set CORS origin header.
    // Access-Control-Allow-Credentials + exact-origin echo is required for
    // the browser to accept cookies on credentialed fetches from a different
    // origin (Vercel preview URLs, etc.). Same-origin calls work regardless.
    const response = new Response(null, { headers: { 'x-middleware-next': '1' } });
    if (isAllowedOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token');
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

  // CSP — enforcing. script-src has no 'unsafe-inline': every page's JS
  // lives in an external file under /public or /public/shared. style-src
  // still allows 'unsafe-inline' for the inline <style> blocks on most
  // pages; a future pass can move those to external .css files and drop it.
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh https://js.stripe.com https://eu.i.posthog.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com blob:",
    "connect-src 'self' https://api.stripe.com https://eu.i.posthog.com https://*.posthog.com https://api.postcodes.io https://api.openrouteservice.org https://esm.sh",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '));

  return response;
}

export const config = {
  matcher: '/:path*',
};
