'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CourseCategory } from '@/lib/types/category';

interface UseCategoriesOptions {
  includeInactive?: boolean;
}

export function useCategories(options: UseCategoriesOptions = {}) {
  const { includeInactive = false } = options;
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/categories?includeInactive=${includeInactive}`);
      const result = await response.json();

      if (result.success) {
        setCategories(result.categories || []);
      } else {
        setError(result.error || '获取分类失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取分类失败');
    } finally {
      setIsLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  return { categories, isLoading, error, refetch: fetchCategories };
}

// Helper to get auth token
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('openmaic_tokens');
  if (stored) {
    try {
      const tokens = JSON.parse(stored);
      return tokens.accessToken || null;
    } catch {
      // Fallback to legacy keys
    }
  }
  return localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || null;
}

// Admin hooks for managing categories
export function useAdminCategories() {
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const token = getAuthToken();
      const response = await fetch('/api/categories?includeInactive=true', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      const result = await response.json();

      if (result.success) {
        setCategories(result.categories || []);
      } else {
        setError(result.error || '获取分类失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取分类失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const createCategory = async (data: {
    name: string;
    description?: string;
    sortOrder?: number;
  }) => {
    const token = getAuthToken();
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();

    if (result.success) {
      await fetchCategories();
    }
    return result;
  };

  const updateCategory = async (
    id: string,
    data: {
      name?: string;
      description?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) => {
    const token = getAuthToken();
    const response = await fetch(`/api/categories?id=${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();

    if (result.success) {
      await fetchCategories();
    }
    return result;
  };

  const deleteCategory = async (id: string) => {
    const token = getAuthToken();
    const response = await fetch(`/api/categories?id=${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
      },
    });
    const result = await response.json();

    if (result.success) {
      await fetchCategories();
    }
    return result;
  };

  return {
    categories,
    setCategories,
    isLoading,
    error,
    refetch: fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
