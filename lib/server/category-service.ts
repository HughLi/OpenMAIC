import { getDatabase } from '@/server/database';
import type { CourseCategory, CreateCategoryInput, UpdateCategoryInput } from '@/lib/types/category';
import { v4 as uuidv4 } from 'uuid';

interface CreateCategoryResult {
  success: boolean;
  category?: CourseCategory;
  error?: string;
}

interface UpdateCategoryResult {
  success: boolean;
  category?: CourseCategory;
  error?: string;
}

interface DeleteCategoryResult {
  success: boolean;
  error?: string;
}

export function createCategory(input: CreateCategoryInput): CreateCategoryResult {
  const db = getDatabase();

  // Check for duplicate name
  const existing = db.prepare('SELECT id FROM course_categories WHERE name = ?').get(input.name);
  if (existing) {
    return { success: false, error: '分类名称已存在' };
  }

  // Auto-assign sortOrder: find max sort_order and add 1
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined || sortOrder === null) {
    const maxResult = db.prepare('SELECT MAX(sort_order) as maxOrder FROM course_categories').get() as { maxOrder: number | null };
    sortOrder = (maxResult.maxOrder ?? -1) + 1;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  const category: CourseCategory = {
    id,
    name: input.name,
    description: input.description,
    sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO course_categories (id, name, description, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    category.id,
    category.name,
    category.description ?? null,
    category.sortOrder,
    category.isActive ? 1 : 0,
    category.createdAt,
    category.updatedAt
  );

  return { success: true, category };
}

export function getAllCategories(includeInactive = true): CourseCategory[] {
  const db = getDatabase();

  let query = 'SELECT * FROM course_categories';
  if (!includeInactive) {
    query += ' WHERE is_active = 1';
  }
  query += ' ORDER BY sort_order ASC, created_at ASC';

  const rows = db.prepare(query).all() as Array<{
    id: string;
    name: string;
    description: string | null;
    sort_order: number;
    is_active: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getCategoryById(id: string): CourseCategory | undefined {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM course_categories WHERE id = ?').get(id) as {
    id: string;
    name: string;
    description: string | null;
    sort_order: number;
    is_active: number;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) return undefined;

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateCategory(id: string, input: UpdateCategoryInput): UpdateCategoryResult {
  const db = getDatabase();

  // Check if category exists
  const existing = getCategoryById(id);
  if (!existing) {
    return { success: false, error: '分类不存在' };
  }

  // Check for duplicate name if updating name
  if (input.name && input.name !== existing.name) {
    const duplicate = db.prepare('SELECT id FROM course_categories WHERE name = ? AND id != ?').get(input.name, id);
    if (duplicate) {
      return { success: false, error: '分类名称已存在' };
    }
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description ?? null);
  }
  if (input.sortOrder !== undefined) {
    updates.push('sort_order = ?');
    values.push(input.sortOrder);
  }
  if (input.isActive !== undefined) {
    updates.push('is_active = ?');
    values.push(input.isActive ? 1 : 0);
  }

  if (updates.length === 0) {
    return { success: true, category: existing };
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE course_categories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return { success: true, category: getCategoryById(id) };
}

export function deleteCategory(id: string): DeleteCategoryResult {
  const db = getDatabase();

  // Check if category exists
  const existing = getCategoryById(id);
  if (!existing) {
    return { success: false, error: '分类不存在' };
  }

  // Check if category is in use
  const inUse = db.prepare('SELECT COUNT(*) as count FROM classrooms WHERE category = ?').get(id) as { count: number };
  if (inUse.count > 0) {
    return { success: false, error: '该分类正在使用中，无法删除' };
  }

  db.prepare('DELETE FROM course_categories WHERE id = ?').run(id);

  return { success: true };
}
