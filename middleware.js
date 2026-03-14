export default async function middleware(request) {
  const url = new URL(request.url);
  
  // Check if maintenance mode is enabled
  const maintenanceMode = process.env.MAINTENANCE_MODE;
  
  if (maintenanceMode === 'true') {
    // Don't redirect if already on maintenance page or API
    if (url.pathname === '/maintenance.html' || url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 200 });
    }
    
    // Redirect to maintenance page
    return new Response(null, {
      status: 307,
      headers: {
        'Location': '/maintenance.html'
      }
    });
  }
  
  // Maintenance mode is off - allow normal traffic
  return new Response(null, { status: 200 });
}

export const config = {
  matcher: '/:path*',
};
