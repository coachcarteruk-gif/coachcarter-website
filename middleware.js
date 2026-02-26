export default function middleware(req) {
  const url = req.nextUrl;
  
  // Check if maintenance mode is enabled
  if (process.env.MAINTENANCE_MODE === 'true') {
    // Allow access to maintenance page itself and API routes
    if (url.pathname === '/maintenance.html' || url.pathname.startsWith('/api/')) {
      return;
    }
    
    // Redirect everything else to maintenance
    return Response.redirect(new URL('/maintenance.html', req.url));
  }
  
  // If trying to access maintenance page when site is live, redirect home
  if (url.pathname === '/maintenance.html' && process.env.MAINTENANCE_MODE !== 'true') {
    return Response.redirect(new URL('/', req.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
