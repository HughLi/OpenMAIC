import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/server/auth-helper';
import {
  updateUserClassroom,
  deleteUserClassroom,
} from '@/lib/server/user-classroom-service';

// PATCH /api/user/classrooms/[id] - Update a user classroom
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, sceneCount, coverImage } = body;

    const result = updateUserClassroom(id, authResult.id, {
      name,
      description,
      sceneCount,
      coverImage,
    });

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '更新失败');
    }

    return apiSuccess({ classroom: result.classroom });
  } catch (error) {
    console.error('Update user classroom error:', error);
    return apiError('INTERNAL_ERROR', 500, '更新课堂失败');
  }
}

// DELETE /api/user/classrooms/[id] - Delete a user classroom
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { id } = await params;

    const result = deleteUserClassroom(id, authResult.id);

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '删除失败');
    }

    return apiSuccess({ message: '课堂已删除' });
  } catch (error) {
    console.error('Delete user classroom error:', error);
    return apiError('INTERNAL_ERROR', 500, '删除课堂失败');
  }
}
