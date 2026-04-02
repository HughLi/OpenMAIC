import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getDatabase } from '@/server/database';
import { requireAdmin } from '@/lib/server/auth-helper';

// POST /api/categories/reorder - Swap sortOrder between two categories
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { categoryId1, categoryId2 } = body;

    if (!categoryId1 || !categoryId2) {
      return apiError('MISSING_REQUIRED_FIELD', 400, '需要提供两个分类ID');
    }

    const db = getDatabase();

    // Get current sort orders
    const cat1 = db.prepare('SELECT id, sort_order FROM course_categories WHERE id = ?').get(categoryId1) as { id: string; sort_order: number } | undefined;
    const cat2 = db.prepare('SELECT id, sort_order FROM course_categories WHERE id = ?').get(categoryId2) as { id: string; sort_order: number } | undefined;

    if (!cat1 || !cat2) {
      return apiError('NOT_FOUND', 404, '分类不存在');
    }

    // Swap sort orders
    const now = new Date().toISOString();
    db.prepare('UPDATE course_categories SET sort_order = ?, updated_at = ? WHERE id = ?').run(cat2.sort_order, now, cat1.id);
    db.prepare('UPDATE course_categories SET sort_order = ?, updated_at = ? WHERE id = ?').run(cat1.sort_order, now, cat2.id);

    // Return updated categories list
    const categories = db.prepare(`
      SELECT id, name, description, sort_order as sortOrder, is_active as isActive, created_at as createdAt, updated_at as updatedAt
      FROM course_categories
      ORDER BY sort_order ASC, created_at ASC
    `).all();

    return apiSuccess({ categories });
  } catch (error) {
    console.error('Reorder categories error:', error);
    return apiError('INTERNAL_ERROR', 500, '调整排序失败');
  }
}
