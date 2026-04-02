import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { apiError } from './api-response';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'openmaic-dev-secret-change-in-production'
);

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export async function getUserFromRequest(request: NextRequest): Promise<AuthUser | null> {
  try {
    // Check for token in header
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '');

    // Also check cookies
    if (!token) {
      token = request.cookies.get('accessToken')?.value;
    }

    if (!token) {
      return null;
    }

    const { payload } = await jwtVerify(token, JWT_SECRET);

    return {
      id: payload.userId as string,
      username: payload.username as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(request: NextRequest): Promise<AuthUser | NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return apiError('UNAUTHORIZED', 401, '请先登录');
  }
  return user;
}

export async function requireAdmin(request: NextRequest): Promise<null | NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return apiError('UNAUTHORIZED', 401, '请先登录');
  }
  if (user.role !== 'admin') {
    return apiError('FORBIDDEN', 403, '需要管理员权限');
  }
  return null;
}
