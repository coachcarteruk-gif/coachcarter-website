export default function middleware(req) {
  // Redirect all traffic to maintenance page
  return Response.redirect(new URL('/maintenance.html', req.url));
}

export const config = {
  matcher: ['/((?!maintenance|api).*)'],
};
