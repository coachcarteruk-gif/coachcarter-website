export default async function middleware(request) {
  const url = new URL(request.url);

  // Check if maintenance mode is enabled
  const maintenanceMode = process.env.MAINTENANCE_MODE;

  if (maintenanceMode === 'true') {
    // Don't redirect if already on maintenance page
    if (url.pathname === '/maintenance.html') {
      return new Response(null, {
        headers: { 'x-middleware-next': '1' }
      });
    }

    // Allow API routes through during maintenance
    if (url.pathname.startsWith('/api/')) {
      return new Response(null, {
        headers: { 'x-middleware-next': '1' }
      });
    }

    // Redirect everything else to maintenance page
    return new Response(null, {
      status: 307,
      headers: {
        'Location': '/maintenance.html'
      }
    });
  }

  // Maintenance mode is off - pass through to actual handlers
  return new Response(null, {
    headers: { 'x-middleware-next': '1' }
  });
}

export const config = {
  matcher: '/:path*',
};
