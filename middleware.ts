import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'openmaic-dev-secret-change-in-production'
);

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth',
  '/api/server-providers',
  '/_next',
  '/favicon.ico',
  '/globals.css',
];

// Paths that require specific roles
const GENERATOR_PATHS = [
  '/generation-preview',
  '/api/classroom/generate',
];

const ADMIN_PATHS = [
  '/admin',
  '/api/users',
  '/api/permission-requests/all',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = request.headers.get('authorization')?.replace('Bearer ', '') ||
                request.cookies.get('accessToken')?.value;

  if (!token) {
    // For API routes, return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    // For page routes, redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    // Verify token
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userRole = payload.role as string;

    // Check generator-only paths
    if (GENERATOR_PATHS.some(path => pathname.startsWith(path))) {
      if (userRole !== 'admin' && userRole !== 'generator') {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { success: false, error: 'Forbidden - Generator access required' },
            { status: 403 }
          );
        }
        return NextResponse.redirect(new URL('/', request.url));
      }
    }

    // Check admin-only paths
    if (ADMIN_PATHS.some(path => pathname.startsWith(path))) {
      if (userRole !== 'admin') {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { success: false, error: 'Forbidden - Admin access required' },
            { status: 403 }
          );
        }
        return NextResponse.redirect(new URL('/', request.url));
      }
    }

    // Add user info to headers for downstream use
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', payload.userId as string);
    requestHeaders.set('x-user-role', userRole);
    requestHeaders.set('x-username', payload.username as string);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    // Token invalid or expired
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)|assets).*)',
  ],
};
