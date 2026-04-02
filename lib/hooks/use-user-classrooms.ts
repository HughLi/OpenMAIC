'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserClassroomListItem, UserClassroomListResponse } from '@/lib/types/user-classroom';
import { listStages, type StageListItem } from '@/lib/utils/stage-storage';

interface UseUserClassroomsOptions {
  page?: number;
  limit?: number;
  search?: string;
}

export function useUserClassrooms(options: UseUserClassroomsOptions = {}) {
  const { page = 1, limit = 20, search } = options;
  const [classrooms, setClassrooms] = useState<UserClassroomListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const fetchClassrooms = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Read from IndexedDB instead of API
      const stages = await listStages();

      // Filter by search term if provided
      let filteredStages = stages;
      if (search) {
        const searchLower = search.toLowerCase();
        filteredStages = stages.filter(
          (stage) =>
            stage.name.toLowerCase().includes(searchLower) ||
            stage.description?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by updatedAt desc (most recent first)
      filteredStages.sort((a, b) => b.updatedAt - a.updatedAt);

      // Paginate
      const total = filteredStages.length;
      const offset = (page - 1) * limit;
      const paginatedStages = filteredStages.slice(offset, offset + limit);

      // Map to UserClassroomListItem format
      const mappedClassrooms: UserClassroomListItem[] = paginatedStages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        description: stage.description,
        sceneCount: stage.sceneCount,
        coverImage: undefined, // TODO: Extract from first slide if needed
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      }));

      setClassrooms(mappedClassrooms);
      setPagination({
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取课堂列表失败');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search]);

  useEffect(() => {
    fetchClassrooms();
  }, [fetchClassrooms]);

  const createClassroom = async (data: {
    classroomId: string;
    name: string;
    description?: string;
    sceneCount?: number;
    coverImage?: string;
  }) => {
    try {
      // Sync to database for compatibility (best effort)
      const response = await fetch('/api/user/classrooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      // Refresh from IndexedDB
      await fetchClassrooms();

      if (result.success) {
        return { success: true, classroom: result.classroom };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      // Even if API fails, refresh from IndexedDB to get the local state
      await fetchClassrooms();
      return { success: false, error: err instanceof Error ? err.message : '创建失败' };
    }
  };

  const updateClassroom = async (
    id: string,
    data: {
      name?: string;
      description?: string;
      sceneCount?: number;
      coverImage?: string;
    }
  ) => {
    try {
      const response = await fetch(`/api/user/classrooms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        await fetchClassrooms();
        return { success: true, classroom: result.classroom };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '更新失败' };
    }
  };

  const deleteClassroom = async (id: string) => {
    try {
      const response = await fetch(`/api/user/classrooms/${id}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        await fetchClassrooms();
        return { success: true };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '删除失败' };
    }
  };

  return {
    classrooms,
    isLoading,
    error,
    pagination,
    refetch: fetchClassrooms,
    createClassroom,
    updateClassroom,
    deleteClassroom,
  };
}
