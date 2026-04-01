import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'openmaic-secret-key-change-in-production'
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
