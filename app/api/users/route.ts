import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getDatabase } from '@/server/database';
import { verifyToken, AccessTokenPayload, UserRole } from '@/server/auth/jwt';
import { v4 as uuidv4 } from 'uuid';

// Middleware to check authentication and admin role
async function requireAuth(request: NextRequest): Promise<AccessTokenPayload | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return apiError('UNAUTHORIZED', 401, 'Missing authorization header');
  }

  const token = authHeader.substring(7);
  try {
    return await verifyToken(token) as AccessTokenPayload;
  } catch {
    return apiError('TOKEN_INVALID', 401, 'Invalid token');
  }
}

// GET /api/users - List all users (admin only)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  if (auth.role !== 'admin') {
    return apiError('FORBIDDEN', 403, 'Admin access required');
  }

  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const status = searchParams.get('status');

    const db = getDatabase();

    let query = `
      SELECT id, username, email, role, status, display_name,
             created_at, last_login_at, login_count
      FROM users
      WHERE 1=1
    `;
    const params: (string | null)[] = [];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const users = db.prepare(query).all(...params);

    return apiSuccess({ users });
  } catch (error) {
    console.error('List users error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to list users');
  }
}

// POST /api/users - Create user or request permission (admin only for creation)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'updateRole') {
      return handleUpdateRole(body, auth);
    }

    if (action === 'approveRequest') {
      return handleApproveRequest(body, auth);
    }

    if (action === 'create') {
      // Only admin can create users directly
      if (auth.role !== 'admin') {
        return apiError('FORBIDDEN', 403, 'Admin access required');
      }
      return handleCreateUser(body);
    }

    if (action === 'grantTemporaryPermission') {
      if (auth.role !== 'admin' && auth.role !== 'generator') {
        return apiError('FORBIDDEN', 403, 'Insufficient permissions');
      }
      return handleGrantTemporaryPermission(body, auth);
    }

    return apiError('INVALID_REQUEST', 400, 'Invalid action');
  } catch (error) {
    console.error('User action error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Action failed');
  }
}

// PATCH /api/users - Update user status or role
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { userId, status, role } = body;

    if (!userId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'User ID is required');
    }

    // Only admin can change roles and status
    if ((role || status) && auth.role !== 'admin') {
      return apiError('FORBIDDEN', 403, 'Admin access required');
    }

    const db = getDatabase();
    const updates: string[] = [];
    const params: (string | null)[] = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (role) {
      updates.push('role = ?');
      params.push(role);
    }

    updates.push("updated_at = datetime('now')");
    params.push(userId);

    db.prepare(`
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    return apiSuccess({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to update user');
  }
}

// DELETE /api/users - Delete or deactivate user
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  if (auth.role !== 'admin') {
    return apiError('FORBIDDEN', 403, 'Admin access required');
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'User ID is required');
    }

    // Prevent deleting yourself
    if (userId === auth.userId) {
      return apiError('INVALID_REQUEST', 400, 'Cannot delete yourself');
    }

    const db = getDatabase();

    // Soft delete - set status to inactive
    db.prepare(`
      UPDATE users SET status = 'inactive', updated_at = datetime('now') WHERE id = ?
    `).run(userId);

    return apiSuccess({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to delete user');
  }
}

async function handleCreateUser(body: {
  username: string;
  email: string;
  password: string;
  role?: UserRole;
  displayName?: string;
}) {
  const { username, email, password, role = 'viewer', displayName } = body;

  if (!username || !email || !password) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Username, email, and password are required');
  }

  // Import here to avoid circular dependencies
  const { hashPassword } = await import('@/server/auth/password');

  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) {
    return apiError('USER_EXISTS', 409, 'Username or email already exists');
  }

  const passwordHash = await hashPassword(password);
  const userId = uuidv4();

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, display_name, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(userId, username, email, passwordHash, role, displayName || username);

  return apiSuccess({
    user: { id: userId, username, email, role, displayName: displayName || username },
    message: 'User created successfully',
  });
}

async function handleUpdateRole(
  body: { userId: string; newRole: UserRole },
  auth: AccessTokenPayload
) {
  const { userId, newRole } = body;

  if (!userId || !newRole) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'User ID and new role are required');
  }

  if (auth.role !== 'admin') {
    return apiError('FORBIDDEN', 403, 'Admin access required');
  }

  const db = getDatabase();
  db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(newRole, userId);

  return apiSuccess({ message: 'User role updated successfully' });
}

async function handleApproveRequest(
  body: { requestId: string; approved: boolean },
  auth: AccessTokenPayload
) {
  const { requestId, approved } = body;

  if (!requestId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Request ID is required');
  }

  if (auth.role !== 'admin') {
    return apiError('FORBIDDEN', 403, 'Admin access required');
  }

  const db = getDatabase();

  const request = db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(requestId) as
    | { id: string; user_id: string; request_type: string; status: string }
    | undefined;

  if (!request || request.status !== 'pending') {
    return apiError('INVALID_REQUEST', 400, 'Request not found or already processed');
  }

  const newStatus = approved ? 'approved' : 'rejected';
  db.prepare(`
    UPDATE permission_requests
    SET status = ?, reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(newStatus, auth.userId, requestId);

  if (approved && request.request_type === 'generator_upgrade') {
    db.prepare("UPDATE users SET role = 'generator' WHERE id = ?").run(request.user_id);
  }

  return apiSuccess({ message: `Request ${newStatus}` });
}

async function handleGrantTemporaryPermission(
  body: { userId: string; durationHours?: number; maxGenerations?: number },
  auth: AccessTokenPayload
) {
  const { userId, durationHours = 24, maxGenerations = 10 } = body;

  if (!userId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'User ID is required');
  }

  const db = getDatabase();

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: UserRole } | undefined;
  if (!user) {
    return apiError('USER_NOT_FOUND', 404, 'User not found');
  }

  // Calculate expiration
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + durationHours);

  const permissionId = uuidv4();
  db.prepare(`
    INSERT INTO temporary_permissions (id, user_id, granted_by, expires_at, max_generations)
    VALUES (?, ?, ?, ?, ?)
  `).run(permissionId, userId, auth.userId, expiresAt.toISOString(), maxGenerations);

  return apiSuccess({
    permission: {
      id: permissionId,
      userId,
      expiresAt: expiresAt.toISOString(),
      maxGenerations,
    },
    message: 'Temporary permission granted successfully',
  });
}
