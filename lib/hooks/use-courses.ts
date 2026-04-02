'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Slide } from '@/lib/types/slides';

export type CourseCategory =
  | 'all'
  | 'programming'
  | 'design'
  | 'business'
  | 'data-science'
  | 'language'
  | 'marketing'
  | 'other';

export interface Course {
  id: string;
  title: string;
  description: string;
  coverImage: string;
  firstSlide?: Slide;
  category: CourseCategory;
  instructor: {
    id: string;
    name: string;
    avatar: string;
  };
  rating: number;
  studentCount: number;
  progress?: number;
  status: 'active' | 'inactive' | 'draft';
  createdAt: string;
  updatedAt?: string;
  price?: number;
}

interface UseCoursesOptions {
  category?: string;
}

interface UseCoursesReturn {
  courses: Course[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// Get auth token from storage (aligned with auth-context.tsx)
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  // Auth context stores tokens as JSON under 'openmaic_tokens'
  const stored = localStorage.getItem('openmaic_tokens');
  if (stored) {
    try {
      const tokens = JSON.parse(stored);
      return tokens.accessToken || null;
    } catch {
      // Fallback to legacy keys
    }
  }

  // Legacy fallback
  return localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || null;
}

export function useCourses(options: UseCoursesOptions = {}): UseCoursesReturn {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = getAuthToken();
      if (!token) {
        throw new Error('未登录');
      }

      const params = new URLSearchParams();
      if (options.category && options.category !== 'all') {
        params.set('category', options.category);
      }

      const response = await fetch(`/api/courses?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取课程失败');
      }

      const data = await response.json();
      if (data.success) {
        setCourses(data.courses);
      } else {
        throw new Error(data.error || '获取课程失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取课程失败');
    } finally {
      setIsLoading(false);
    }
  }, [options.category]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  return {
    courses,
    isLoading,
    error,
    refetch: fetchCourses,
  };
}

// Hook for admin to get all courses
interface UseAdminCoursesReturn {
  courses: Course[];
  stats: {
    totalCourses: number;
    activeCourses: number;
  } | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAdminCourses(status?: string): UseAdminCoursesReturn {
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState<{ totalCourses: number; activeCourses: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = getAuthToken();
      if (!token) {
        throw new Error('未登录');
      }

      const params = new URLSearchParams();
      if (status && status !== 'all') {
        params.set('status', status);
      }

      const response = await fetch(`/api/admin/courses?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取课程失败');
      }

      const data = await response.json();
      if (data.success) {
        setCourses(data.courses);
        setStats(data.stats);
      } else {
        throw new Error(data.error || '获取课程失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取课程失败');
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  return {
    courses,
    stats,
    isLoading,
    error,
    refetch: fetchCourses,
  };
}

// Update course metadata
export async function updateCourse(
  courseId: string,
  updates: {
    title?: string;
    description?: string;
    category?: string;
    coverImage?: string;
    visibility?: 'private' | 'public' | 'shared';
  }
): Promise<{ success: boolean; error?: string; course?: Course }> {
  const token = getAuthToken();
  if (!token) {
    return { success: false, error: '未登录' };
  }

  try {
    const response = await fetch(`/api/classroom?id=${courseId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || '更新失败' };
    }

    return { success: true, course: data.classroom };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '更新失败' };
  }
}

// Upload cover image
export async function uploadCoverImage(
  courseId: string,
  file: File
): Promise<{ success: boolean; error?: string; coverImage?: string }> {
  const token = getAuthToken();
  if (!token) {
    return { success: false, error: '未登录' };
  }

  try {
    const formData = new FormData();
    formData.append('cover', file);

    const response = await fetch(`/api/classroom/${courseId}/cover`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || '上传失败' };
    }

    return { success: true, coverImage: data.coverImage };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '上传失败' };
  }
}

// Delete course
export async function deleteCourse(courseId: string): Promise<{ success: boolean; error?: string }> {
  const token = getAuthToken();
  if (!token) {
    return { success: false, error: '未登录' };
  }

  try {
    const response = await fetch(`/api/classroom?id=${courseId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || '删除失败' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '删除失败' };
  }
}
