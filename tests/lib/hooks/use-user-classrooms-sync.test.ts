import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// @vitest-environment jsdom

import { useUserClassroomsSync } from '@/lib/hooks/use-user-classrooms-sync';

// Mock fetch
global.fetch = vi.fn();

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock useAuth hook
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'user-123', email: 'test@example.com' },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Mock listStages from stage-storage
vi.mock('@/lib/utils/stage-storage', () => ({
  listStages: vi.fn(),
}));

import { listStages } from '@/lib/utils/stage-storage';

describe('useUserClassroomsSync', () => {
  const mockApiClassrooms = [
    {
      id: 'classroom-1',
      name: 'Course from API 1',
      description: 'Description 1',
      sceneCount: 5,
      coverImage: null,
      createdAt: Date.now() - 10000,
      updatedAt: Date.now(),
    },
    {
      id: 'classroom-2',
      name: 'Course from API 2',
      description: 'Description 2',
      sceneCount: 3,
      coverImage: 'cover.jpg',
      createdAt: Date.now() - 20000,
      updatedAt: Date.now() - 5000,
    },
  ];

  const mockIndexedDBStages = [
    {
      id: 'classroom-3',
      name: 'Course from IndexedDB',
      description: 'Local description',
      sceneCount: 2,
      createdAt: Date.now() - 30000,
      updatedAt: Date.now() - 10000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should start with loading state', () => {
      const { result } = renderHook(() => useUserClassroomsSync());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.classrooms).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('API fetch priority', () => {
    it('should fetch from API first when user is authenticated', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: mockApiClassrooms,
          pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      const { result } = renderHook(() => useUserClassroomsSync());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.classrooms).toHaveLength(2);
      expect(result.current.classrooms[0].id).toBe('classroom-1');
      expect(global.fetch).toHaveBeenCalledWith('/api/user/classrooms?page=1&limit=20', expect.any(Object));
    });

    it('should fallback to IndexedDB when API fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      (listStages as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockIndexedDBStages);

      const { result } = renderHook(() => useUserClassroomsSync());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.classrooms).toHaveLength(1);
      expect(result.current.classrooms[0].id).toBe('classroom-3');
    });

    it('should merge API and IndexedDB data when both available', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: mockApiClassrooms,
          pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      (listStages as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockIndexedDBStages);

      const { result } = renderHook(() => useUserClassroomsSync());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have API courses + IndexedDB courses
      expect(result.current.classrooms).toHaveLength(3);
    });

    it('should deduplicate courses with same ID', async () => {
      const apiClassroomWithSameId = [
        {
          id: 'classroom-3', // Same ID as IndexedDB
          name: 'Course from API (newer)',
          description: 'API description',
          sceneCount: 10,
          coverImage: null,
          createdAt: Date.now() - 30000,
          updatedAt: Date.now(), // Newer
        },
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: apiClassroomWithSameId,
          pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      (listStages as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockIndexedDBStages);

      const { result } = renderHook(() => useUserClassroomsSync());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have only 1 course, using API version (newer)
      expect(result.current.classrooms).toHaveLength(1);
      expect(result.current.classrooms[0].name).toBe('Course from API (newer)');
      expect(result.current.classrooms[0].sceneCount).toBe(10);
    });
  });

  describe('sorting', () => {
    it('should sort courses by updatedAt desc', async () => {
      const unsortedCourses = [
        { ...mockApiClassrooms[1], updatedAt: 1000 },
        { ...mockApiClassrooms[0], updatedAt: 3000 },
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: unsortedCourses,
          pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      const { result } = renderHook(() => useUserClassroomsSync());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should be sorted by updatedAt desc (newest first)
      expect(result.current.classrooms[0].updatedAt).toBe(3000);
      expect(result.current.classrooms[1].updatedAt).toBe(1000);
    });
  });

  describe('pagination', () => {
    it('should handle pagination options', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: mockApiClassrooms.slice(0, 1),
          pagination: { total: 2, page: 1, limit: 1, totalPages: 2 },
        }),
      });

      const { result } = renderHook(() => useUserClassroomsSync({ page: 1, limit: 1 }));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.pagination.totalPages).toBe(2);
      expect(result.current.classrooms).toHaveLength(1);
    });

    it('should support pagination change', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            classrooms: mockApiClassrooms.slice(0, 1),
            pagination: { total: 2, page: 1, limit: 1, totalPages: 2 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            classrooms: mockApiClassrooms.slice(1, 2),
            pagination: { total: 2, page: 2, limit: 1, totalPages: 2 },
          }),
        });

      const { result } = renderHook(() => useUserClassroomsSync({ page: 1, limit: 1 }));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Change page
      act(() => {
        result.current.setPage(2);
      });

      await waitFor(() => {
        expect(result.current.pagination.page).toBe(2);
      });
    });
  });

  describe('refresh', () => {
    it('should support manual refresh', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: mockApiClassrooms,
          pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      const { result } = renderHook(() => useUserClassroomsSync());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Mock for refresh
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: [...mockApiClassrooms, { ...mockApiClassrooms[0], id: 'classroom-new' }],
          pagination: { total: 3, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.classrooms).toHaveLength(3);
    });
  });

  describe('search', () => {
    it('should support search functionality', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          classrooms: [mockApiClassrooms[0]],
          pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
        }),
      });

      const { result } = renderHook(() => useUserClassroomsSync({ search: 'API 1' }));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=API'),
        expect.any(Object)
      );
    });
  });
});
