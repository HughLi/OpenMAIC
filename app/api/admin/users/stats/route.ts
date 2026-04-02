import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/server/auth-helper';
import { getUserStatistics } from '@/lib/server/user-management-service';

// GET /api/admin/users/stats - Get user statistics
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // Check if user is admin
  if (authResult.role !== 'admin') {
    return apiError('FORBIDDEN', 403, '需要管理员权限');
  }

  try {
    const stats = getUserStatistics();
    return apiSuccess(stats);
  } catch (error) {
    console.error('Get user stats error:', error);
    return apiError('INTERNAL_ERROR', 500, '获取用户统计失败');
  }
}
