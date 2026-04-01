import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getDatabase } from '@/server/database';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import {
  generateTokenPair,
  verifyToken,
  verifyRefreshToken,
  revokeRefreshToken,
  AccessTokenPayload,
} from '@/server/auth/jwt';

// User role type
export type UserRole = 'admin' | 'generator' | 'viewer';

// Database user interface
interface DbUser {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'pending';
  display_name: string | null;
}

// POST /api/auth - Login or register
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'login':
        return handleLogin(body);
      case 'register':
        return handleRegister(body);
      case 'refresh':
        return handleRefresh(body);
      case 'logout':
        return handleLogout(body);
      default:
        return apiError('INVALID_REQUEST', 400, 'Invalid action');
    }
  } catch (error) {
    console.error('Auth error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Authentication failed');
  }
}

// GET /api/auth - Get current user info
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return apiError('UNAUTHORIZED', 401, 'Missing authorization header');
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token) as AccessTokenPayload;

    if (payload.type !== 'access') {
      return apiError('TOKEN_INVALID', 401, 'Invalid token type');
    }

    const db = getDatabase();
    const user = db.prepare(
      'SELECT id, username, email, role, display_name, status FROM users WHERE id = ?'
    ).get(payload.userId) as DbUser | undefined;

    if (!user || user.status !== 'active') {
      return apiError('USER_NOT_FOUND', 404, 'User not found or inactive');
    }

    return apiSuccess({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return apiError('TOKEN_EXPIRED', 401, 'Token expired');
    }
    return apiError('TOKEN_INVALID', 401, 'Invalid token');
  }
}

async function handleLogin({ username, password }: { username: string; password: string }) {
  if (!username || !password) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Username and password are required');
  }

  const db = getDatabase();
  const user = db.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).get(username, username) as DbUser | undefined;

  if (!user) {
    return apiError('INVALID_CREDENTIALS', 401, 'Invalid username or password');
  }

  if (user.status !== 'active') {
    return apiError('FORBIDDEN', 403, 'Account is not active');
  }

  const validPassword = await verifyPassword(password, user.password_hash);
  if (!validPassword) {
    return apiError('INVALID_CREDENTIALS', 401, 'Invalid username or password');
  }

  // Update last login
  db.prepare(
    "UPDATE users SET last_login_at = datetime('now'), login_count = login_count + 1 WHERE id = ?"
  ).run(user.id);

  const tokens = await generateTokenPair(user.id, user.username, user.role);

  return apiSuccess({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
    },
    tokens,
  });
}

async function handleRegister({
  username,
  email,
  password,
  displayName,
}: {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}) {
  if (!username || !email || !password) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Username, email, and password are required');
  }

  // Validate username (alphanumeric, underscore, hyphen, 3-32 chars)
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return apiError('INVALID_REQUEST', 400, 'Username must be 3-32 alphanumeric characters');
  }

  // Validate email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid email format');
  }

  // Validate password (min 6 chars)
  if (password.length < 6) {
    return apiError('INVALID_REQUEST', 400, 'Password must be at least 6 characters');
  }

  const db = getDatabase();

  // Check if username exists
  const existingUser = db.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).get(username, email);

  if (existingUser) {
    return apiError('USER_EXISTS', 409, 'Username or email already exists');
  }

  const passwordHash = await hashPassword(password);
  const userId = uuidv4();

  // New registrations are viewers by default, pending admin approval for generator
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, display_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username, email, passwordHash, 'viewer', displayName || username, 'active');

  const tokens = await generateTokenPair(userId, username, 'viewer');

  return apiSuccess({
    user: {
      id: userId,
      username,
      email,
      role: 'viewer' as UserRole,
      displayName: displayName || username,
    },
    tokens,
  });
}

async function handleRefresh({ refreshToken }: { refreshToken: string }) {
  if (!refreshToken) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Refresh token is required');
  }

  try {
    const payload = await verifyRefreshToken(refreshToken);

    // Generate new token pair
    const tokens = await generateTokenPair(payload.userId, payload.username, payload.role);

    // Revoke old refresh token
    revokeRefreshToken(payload.tokenId);

    return apiSuccess({ tokens });
  } catch (error) {
    return apiError('TOKEN_INVALID', 401, 'Invalid or expired refresh token');
  }
}

async function handleLogout({ refreshToken }: { refreshToken?: string }) {
  if (refreshToken) {
    try {
      const payload = await verifyRefreshToken(refreshToken);
      revokeRefreshToken(payload.tokenId);
    } catch {
      // Ignore errors during logout
    }
  }

  return apiSuccess({ message: 'Logged out successfully' });
}
