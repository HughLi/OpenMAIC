import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabase, resetDatabase } from '@/server/database';
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from '@/lib/server/category-service';
import { v4 as uuidv4 } from 'uuid';

describe('Category Service', () => {
  beforeEach(() => {
    // Reset database before each test
    resetDatabase();
  });

  afterEach(() => {
    // Cleanup after each test
  });

  describe('createCategory', () => {
    it('should create a category successfully', () => {
      const result = createCategory({
        name: '编程开发',
        description: '软件开发相关课程',
        sortOrder: 1,
      });

      expect(result.success).toBe(true);
      expect(result.category).toBeDefined();
      expect(result.category?.name).toBe('编程开发');
      expect(result.category?.description).toBe('软件开发相关课程');
      expect(result.category?.sortOrder).toBe(1);
      expect(result.category?.isActive).toBe(true);
    });

    it('should fail when creating category with duplicate name', () => {
      createCategory({ name: '编程开发' });

      const result = createCategory({ name: '编程开发' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('已存在');
    });

    it('should create category with default sortOrder 0', () => {
      const result = createCategory({ name: '设计' });

      expect(result.success).toBe(true);
      expect(result.category?.sortOrder).toBe(0);
    });
  });

  describe('getAllCategories', () => {
    it('should return empty array when no categories exist', () => {
      const categories = getAllCategories();
      expect(categories).toEqual([]);
    });

    it('should return all categories sorted by sortOrder', () => {
      createCategory({ name: '数据科学', sortOrder: 3 });
      createCategory({ name: '编程开发', sortOrder: 1 });
      createCategory({ name: '设计', sortOrder: 2 });

      const categories = getAllCategories();

      expect(categories).toHaveLength(3);
      expect(categories[0].name).toBe('编程开发');
      expect(categories[1].name).toBe('设计');
      expect(categories[2].name).toBe('数据科学');
    });

    it('should return only active categories when includeInactive is false', () => {
      const active = createCategory({ name: '编程开发', sortOrder: 1 });
      const inactive = createCategory({ name: '废弃分类', sortOrder: 2 });

      // Deactivate one category
      if (inactive.category) {
        updateCategory(inactive.category.id, { isActive: false });
      }

      const categories = getAllCategories(false);

      expect(categories).toHaveLength(1);
      expect(categories[0].name).toBe('编程开发');
    });
  });

  describe('getCategoryById', () => {
    it('should return category by id', () => {
      const created = createCategory({ name: '编程开发' });

      const category = getCategoryById(created.category!.id);

      expect(category).toBeDefined();
      expect(category?.name).toBe('编程开发');
    });

    it('should return undefined for non-existent id', () => {
      const category = getCategoryById(uuidv4());

      expect(category).toBeUndefined();
    });
  });

  describe('updateCategory', () => {
    it('should update category name', () => {
      const created = createCategory({ name: '编程开发' });

      const result = updateCategory(created.category!.id, { name: '软件开发' });

      expect(result.success).toBe(true);
      expect(result.category?.name).toBe('软件开发');
    });

    it('should fail when updating to duplicate name', () => {
      createCategory({ name: '编程开发' });
      const design = createCategory({ name: '设计' });

      const result = updateCategory(design.category!.id, { name: '编程开发' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('已存在');
    });

    it('should deactivate category', () => {
      const created = createCategory({ name: '编程开发' });

      const result = updateCategory(created.category!.id, { isActive: false });

      expect(result.success).toBe(true);
      expect(result.category?.isActive).toBe(false);
    });
  });

  describe('deleteCategory', () => {
    it('should delete category successfully', () => {
      const created = createCategory({ name: '编程开发' });

      const result = deleteCategory(created.category!.id);

      expect(result.success).toBe(true);
      expect(getCategoryById(created.category!.id)).toBeUndefined();
    });

    it('should fail when deleting non-existent category', () => {
      const result = deleteCategory(uuidv4());

      expect(result.success).toBe(false);
      expect(result.error).toContain('不存在');
    });

    it('should fail when category is in use by courses', () => {
      const created = createCategory({ name: '编程开发' });

      // Mock category in use
      const db = getDatabase();
      db.prepare("UPDATE classrooms SET category = ? WHERE category = 'other'").run(created.category!.id);

      const result = deleteCategory(created.category!.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('正在使用');
    });
  });
});
