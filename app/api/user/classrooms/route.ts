import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/server/auth-helper';
import {
  createUserClassroom,
  listUserClassrooms,
} from '@/lib/server/user-classroom-service';

// GET /api/user/classrooms - List user's classrooms
// Filters private courses based on user role
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || undefined;

    const result = listUserClassrooms(authResult.id, { page, limit, search, userRole: authResult.role });

    return apiSuccess({
      classrooms: result.classrooms.map(c => ({
        id: c.classroomId,
        name: c.name,
        description: c.description,
        sceneCount: c.sceneCount,
        coverImage: c.coverImage,
        createdAt: new Date(c.createdAt).getTime(),
        updatedAt: new Date(c.updatedAt).getTime(),
      })),
      pagination: {
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error('List user classrooms error:', error);
    return apiError('INTERNAL_ERROR', 500, '获取课堂列表失败');
  }
}

// POST /api/user/classrooms - Create or update a user classroom
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { classroomId, name, description, sceneCount, coverImage } = body;

    if (!classroomId || !name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '课堂ID和名称不能为空');
    }

    const result = createUserClassroom(authResult.id, {
      classroomId,
      name,
      description,
      sceneCount,
      coverImage,
    });

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '创建失败');
    }

    return apiSuccess({ classroom: result.classroom });
  } catch (error) {
    console.error('Create user classroom error:', error);
    return apiError('INTERNAL_ERROR', 500, '创建课堂失败');
  }
}
