import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/server/auth-helper';
import {
  listUsers,
  approveUser,
  rejectUser,
  freezeUser,
  unfreezeUser,
  changeUserRole,
  deleteUser,
  getUserStatistics,
  getPendingApprovalCount,
} from '@/lib/server/user-management-service';
import type { UserRole, UserStatus } from '@/lib/types/user';

// GET /api/admin/users - List users with filters
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check if user is admin
  if (authResult.role !== 'admin') {
    return apiError('FORBIDDEN', 403, '需要管理员权限');
  }

  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role') as UserRole | null;
    const status = searchParams.get('status') as UserStatus | null;
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const result = listUsers(
      { role: role || undefined, status: status || undefined, search: search || undefined },
      page,
      limit
    );

    return apiSuccess({
      users: result.users,
      pagination: {
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error('List users error:', error);
    return apiError('INTERNAL_ERROR', 500, '获取用户列表失败');
  }
}

// POST /api/admin/users/:id/approve - Approve user
export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check if user is admin
  if (authResult.role !== 'admin') {
    return apiError('FORBIDDEN', 403, '需要管理员权限');
  }

  const adminId = authResult.id;

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');
    const action = searchParams.get('action');

    if (!userId || !action) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '用户ID和操作类型不能为空');
    }

    const body = await request.json().catch(() => ({}));
    const { reason } = body;

    let result;
    switch (action) {
      case 'approve':
        result = approveUser(userId, adminId);
        break;
      case 'reject':
        result = rejectUser(userId, adminId, reason);
        break;
      case 'freeze':
        result = freezeUser(userId, adminId, reason);
        break;
      case 'unfreeze':
        result = unfreezeUser(userId, adminId);
        break;
      default:
        return apiError('INVALID_REQUEST', 400, '无效的操作类型');
    }

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '操作失败');
    }

    return apiSuccess({ user: result.user });
  } catch (error) {
    console.error('User action error:', error);
    return apiError('INTERNAL_ERROR', 500, '操作失败');
  }
}

// DELETE /api/admin/users/:id - Delete user
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check if user is admin
  if (authResult.role !== 'admin') {
    return apiError('FORBIDDEN', 403, '需要管理员权限');
  }

  const adminId = authResult.id;

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '用户ID不能为空');
    }

    const result = deleteUser(userId, adminId);

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '删除失败');
    }

    return apiSuccess({ message: '用户已删除' });
  } catch (error) {
    console.error('Delete user error:', error);
    return apiError('INTERNAL_ERROR', 500, '删除失败');
  }
}
