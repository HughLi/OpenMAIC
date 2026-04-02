import { type NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
} from '@/lib/server/category-service';
import { getDatabase } from '@/server/database';
import { requireAdmin } from '@/lib/server/auth-helper';

// GET /api/categories - Get all categories
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const categories = getAllCategories(includeInactive);
    return apiSuccess({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    return apiError('INTERNAL_ERROR', 500, '获取分类失败');
  }
}

// POST /api/categories - Create new category (admin only)
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, description, sortOrder } = body;

    if (!name || typeof name !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, '分类名称不能为空');
    }

    const result = createCategory({
      name: name.trim(),
      description: description?.trim(),
      sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
    });

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '创建分类失败');
    }

    return apiSuccess({ category: result.category }, 201);
  } catch (error) {
    console.error('Create category error:', error);
    return apiError('INTERNAL_ERROR', 500, '创建分类失败');
  }
}

// PATCH /api/categories?id=xxx - Update category (admin only)
export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '分类ID不能为空');
    }

    const body = await request.json();
    const { name, description, sortOrder, isActive } = body;

    const result = updateCategory(id, {
      name: name?.trim(),
      description: description?.trim(),
      sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
      isActive: typeof isActive === 'boolean' ? isActive : undefined,
    });

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '更新分类失败');
    }

    return apiSuccess({ category: result.category });
  } catch (error) {
    console.error('Update category error:', error);
    return apiError('INTERNAL_ERROR', 500, '更新分类失败');
  }
}

// DELETE /api/categories?id=xxx - Delete category (admin only)
export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '分类ID不能为空');
    }

    const result = deleteCategory(id);

    if (!result.success) {
      return apiError('INVALID_REQUEST', 400, result.error || '删除分类失败');
    }

    return apiSuccess({ message: '分类已删除' });
  } catch (error) {
    console.error('Delete category error:', error);
    return apiError('INTERNAL_ERROR', 500, '删除分类失败');
  }
}
