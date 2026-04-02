export interface Instructor {
  id: string;
  name: string;
  avatar: string;
  title?: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  coverImage: string;
  category: CourseCategory;
  instructor: Instructor;
  rating: number;
  studentCount: number;
  progress?: number;
  status: 'active' | 'inactive' | 'draft';
  createdAt: string;
  price?: number;
}

export type CourseCategory =
  | 'all'
  | 'programming'
  | 'design'
  | 'business'
  | 'data-science'
  | 'language'
  | 'marketing';

export interface CourseCategoryInfo {
  id: CourseCategory;
  name: string;
  icon: string;
}

export interface CourseStats {
  totalCourses: number;
  totalStudents: number;
  completionRate: number;
}

export type ViewMode = 'grid' | 'list';
export type SortOption = 'newest' | 'popular' | 'rating';
