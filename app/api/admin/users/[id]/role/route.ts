import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/server/auth-helper';
import { changeUserRole } from '@/lib/server/user-management-service';
import type { UserRole } from '@/lib/types/user';

// POST /api/admin/users/:id/role - Change user role
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check if user is admin
  if (authResult.role !== 'admin') {
    return apiError('FORBIDDEN', 403, '需要管理员权限');
  }

  const adminId = authResult.id;

  try {
    const { id: userId } = await params;
    const body = await request.json();
    const { role, reason } = body;

    if (!userId || !role) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '用户ID和新角色不能为空');
    }

    // Validate role
    const validRoles: UserRole[] = ['admin', 'generator', 'viewer'];
    if (!validRoles.includes(role)) {
      return apiError('INVALID_REQUEST', 400, '无效的角色类型');
    }

    const result = changeUserRole(userId, role as UserRole, adminId, reason);

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '角色变更失败');
    }

    return apiSuccess({ user: result.user });
  } catch (error) {
    console.error('Change role error:', error);
    return apiError('INTERNAL_ERROR', 500, '角色变更失败');
  }
}
