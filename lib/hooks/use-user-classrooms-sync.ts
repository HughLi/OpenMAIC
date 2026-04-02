'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { listStages } from '@/lib/utils/stage-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('useUserClassroomsSync');

export interface UserClassroomListItem {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  coverImage?: string;
  createdAt: number;
  updatedAt: number;
  source?: 'api' | 'indexeddb';
}

interface UseUserClassroomsSyncOptions {
  page?: number;
  limit?: number;
  search?: string;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UseUserClassroomsSyncReturn {
  classrooms: UserClassroomListItem[];
  isLoading: boolean;
  error: string | null;
  pagination: Pagination;
  refresh: () => Promise<void>;
  setPage: (page: number) => void;
}

/**
 * Hook for syncing and listing user classrooms
 * Prioritizes API data, falls back to IndexedDB
 * Merges both sources and deduplicates
 */
export function useUserClassroomsSync(
  options: UseUserClassroomsSyncOptions = {}
): UseUserClassroomsSyncReturn {
  const { page: initialPage = 1, limit = 20, search } = options;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [classrooms, setClassrooms] = useState<UserClassroomListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: initialPage,
    limit,
    totalPages: 0,
  });

  // Track last fetch to prevent duplicate requests
  const lastFetchRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchClassrooms = useCallback(async () => {
    // Don't fetch if auth is still loading
    if (authLoading) return;

    const cacheKey = `${user?.id || 'anonymous'}-${page}-${limit}-${search || ''}`;
    if (lastFetchRef.current === cacheKey && classrooms.length > 0) {
      return;
    }
    lastFetchRef.current = cacheKey;

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      setIsLoading(true);
      setError(null);

      let apiClassrooms: UserClassroomListItem[] = [];
      let indexedDBClassrooms: UserClassroomListItem[] = [];
      let apiSuccess = false;

      // 1. Try API first (if authenticated)
      if (isAuthenticated && user) {
        try {
          const params = new URLSearchParams({
            page: String(page),
            limit: String(limit),
            ...(search && { search }),
          });

          const response = await fetch(`/api/user/classrooms?${params}`, {
            signal: abortControllerRef.current.signal,
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.classrooms) {
              apiClassrooms = result.classrooms.map((c: UserClassroomListItem & { source?: string }) => ({
                ...c,
                source: 'api' as const,
              }));
              apiSuccess = true;

              if (result.pagination) {
                setPagination(result.pagination);
              }

              log.info('Fetched classrooms from API:', apiClassrooms.length);
            }
          } else {
            log.warn('API request failed:', response.status);
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }
          log.warn('Failed to fetch from API:', err);
        }
      }

      // 2. Fetch from IndexedDB (always, as fallback or supplement)
      try {
        const stages = await listStages();
        indexedDBClassrooms = stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          description: stage.description,
          sceneCount: stage.sceneCount,
          coverImage: undefined,
          createdAt: stage.createdAt,
          updatedAt: stage.updatedAt,
          source: 'indexeddb' as const,
        }));
        log.info('Fetched classrooms from IndexedDB:', indexedDBClassrooms.length);
      } catch (err) {
        log.warn('Failed to fetch from IndexedDB:', err);
      }

      // 3. Merge and deduplicate
      // Priority: API > IndexedDB (API is newer/more authoritative)
      const mergedMap = new Map<string, UserClassroomListItem>();

      // Add IndexedDB items first
      indexedDBClassrooms.forEach((item) => {
        mergedMap.set(item.id, item);
      });

      // Add API items (will override IndexedDB if same ID)
      apiClassrooms.forEach((item) => {
        mergedMap.set(item.id, item);
      });

      let mergedClassrooms = Array.from(mergedMap.values());

      // 4. Apply search filter locally (if not handled by API)
      if (search && !apiSuccess) {
        const searchLower = search.toLowerCase();
        mergedClassrooms = mergedClassrooms.filter(
          (c) =>
            c.name.toLowerCase().includes(searchLower) ||
            c.description?.toLowerCase().includes(searchLower)
        );
      }

      // 5. Sort by updatedAt desc (newest first)
      mergedClassrooms.sort((a, b) => b.updatedAt - a.updatedAt);

      // 6. Apply pagination locally if API didn't handle it
      if (!apiSuccess) {
        const total = mergedClassrooms.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        mergedClassrooms = mergedClassrooms.slice(offset, offset + limit);

        setPagination({
          total,
          page,
          limit,
          totalPages,
        });
      }

      setClassrooms(mergedClassrooms);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : '获取课堂列表失败';
      log.error('Error fetching classrooms:', err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user, isAuthenticated, authLoading, page, limit, search]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchClassrooms();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchClassrooms]);

  const refresh = useCallback(async () => {
    lastFetchRef.current = ''; // Clear cache to force refetch
    await fetchClassrooms();
  }, [fetchClassrooms]);

  const handleSetPage = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  return {
    classrooms,
    isLoading,
    error,
    pagination,
    refresh,
    setPage: handleSetPage,
  };
}
