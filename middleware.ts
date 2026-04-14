import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'openmaic-dev-secret-change-in-production'
);

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyAccessCodeToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth',
  '/api/categories',
  '/api/server-providers',
  '/api/classroom', // Public classroom access (API route handles visibility check)
  '/api/classroom/audio', // Public audio access
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

  // Access code check (from upstream)
  const accessCode = process.env.ACCESS_CODE;
  if (accessCode) {
    // Whitelist: access-code endpoints, health check
    if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
      return NextResponse.next();
    }

    // Check cookie — validate HMAC signature
    const cookie = request.cookies.get('openmaic_access');
    if (!cookie?.value || !(await verifyAccessCodeToken(cookie.value, accessCode))) {
      // API requests without valid cookie → 401
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
          { status: 401 },
        );
      }
      // Page requests → let through, frontend shows modal
      return NextResponse.next();
    }
  }

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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)|assets|logos/).*)',
  ],
};
