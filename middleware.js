export default function middleware(req) {
  const url = req.nextUrl;
  
  if (process.env.MAINTENANCE_MODE === 'true') {
    if (url.pathname === '/maintenance.html' || url.pathname.startsWith('/api/')) {
      return;
    }
    return Response.redirect(new URL('/maintenance.html', req.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
