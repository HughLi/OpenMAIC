/**
 * Course Category Types
 */

export interface CourseCategory {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export type CourseCategoryCode =
  | 'programming'
  | 'design'
  | 'business'
  | 'data-science'
  | 'language'
  | 'marketing'
  | 'other';

export const CATEGORY_CODE_MAP: Record<string, CourseCategoryCode> = {
  '编程开发': 'programming',
  'UI/UX设计': 'design',
  '商业管理': 'business',
  '数据科学': 'data-science',
  '语言学习': 'language',
  '市场营销': 'marketing',
  '其他': 'other',
};
