import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getDatabase } from '@/server/database';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { v4 as uuidv4 } from 'uuid';

// Middleware to check authentication
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

// GET /api/permission-requests - List permission requests
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const myRequests = searchParams.get('mine') === 'true';

    const db = getDatabase();

    // Viewers can only see their own requests
    // Admins can see all requests
    let query = `
      SELECT pr.*,
             u.username as user_username,
             u.display_name as user_display_name,
             reviewer.username as reviewer_username
      FROM permission_requests pr
      JOIN users u ON pr.user_id = u.id
      LEFT JOIN users reviewer ON pr.reviewed_by = reviewer.id
      WHERE 1=1
    `;
    const params: (string | null)[] = [];

    if (myRequests || auth.role !== 'admin') {
      query += ' AND pr.user_id = ?';
      params.push(auth.userId);
    }

    if (status) {
      query += ' AND pr.status = ?';
      params.push(status);
    }

    query += ' ORDER BY pr.requested_at DESC';

    const requests = db.prepare(query).all(...params);

    return apiSuccess({ requests });
  } catch (error) {
    console.error('List permission requests error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to list permission requests');
  }
}

// POST /api/permission-requests - Create a new permission request
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { reason, requestType = 'generator_upgrade' } = body;

    // Only viewers can request generator access
    // Generators can request admin access (future feature)
    if (auth.role === 'admin') {
      return apiError('INVALID_REQUEST', 400, 'Admins cannot request permissions');
    }

    const db = getDatabase();

    // Check for existing pending request
    const existing = db.prepare(`
      SELECT id FROM permission_requests
      WHERE user_id = ? AND status = 'pending'
    `).get(auth.userId);

    if (existing) {
      return apiError('INVALID_REQUEST', 400, 'You already have a pending request');
    }

    const requestId = uuidv4();
    db.prepare(`
      INSERT INTO permission_requests (id, user_id, request_type, reason, status, requested_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'))
    `).run(requestId, auth.userId, requestType, reason || null);

    return apiSuccess({
      request: {
        id: requestId,
        userId: auth.userId,
        requestType,
        reason,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      },
      message: 'Permission request submitted successfully',
    });
  } catch (error) {
    console.error('Create permission request error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to submit permission request');
  }
}

// DELETE /api/permission-requests - Cancel a pending request
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('id');

    if (!requestId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Request ID is required');
    }

    const db = getDatabase();

    // Users can only cancel their own requests
    // Admins can cancel any request
    let query = 'SELECT id, user_id, status FROM permission_requests WHERE id = ?';
    const params: (string | null)[] = [requestId];

    if (auth.role !== 'admin') {
      query += ' AND user_id = ?';
      params.push(auth.userId);
    }

    const existing = db.prepare(query).get(...params) as
      | { id: string; user_id: string; status: string }
      | undefined;

    if (!existing) {
      return apiError('NOT_FOUND', 404, 'Request not found');
    }

    if (existing.status !== 'pending') {
      return apiError('INVALID_REQUEST', 400, 'Can only cancel pending requests');
    }

    db.prepare('DELETE FROM permission_requests WHERE id = ?').run(requestId);

    return apiSuccess({ message: 'Permission request cancelled successfully' });
  } catch (error) {
    console.error('Cancel permission request error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to cancel permission request');
  }
}
