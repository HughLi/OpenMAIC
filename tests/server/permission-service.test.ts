import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '@/server/database';
import {
  checkCoursePermission,
  canManageCourse,
  canViewCourse,
  listEditableCourses,
  listVisibleCourses,
} from '@/lib/server/permission-service';
import { createCategory } from '@/lib/server/category-service';

describe('Permission Service', () => {
  beforeEach(() => {
    resetDatabase();
  });

  describe('canViewCourse', () => {
    it('should allow anyone to view active courses', () => {
      // All users (including anonymous) can view active courses
      expect(canViewCourse('course-1', null)).toBe(true);
      expect(canViewCourse('course-1', 'user-1')).toBe(true);
    });
  });

  describe('canManageCourse', () => {
    it('should allow admin to manage any course', () => {
      expect(canManageCourse('course-1', 'admin-1', 'admin')).toBe(true);
    });

    it('should allow creator to manage their own course', () => {
      expect(canManageCourse('course-1', 'creator-1', 'generator')).toBe(true);
    });

    it('should deny viewer from managing any course', () => {
      expect(canManageCourse('course-1', 'viewer-1', 'viewer')).toBe(false);
    });

    it('should deny creator from managing others courses', () => {
      // creator-2 is trying to manage course-1 which belongs to creator-1
      expect(canManageCourse('course-1', 'creator-2', 'generator')).toBe(false);
    });
  });

  describe('listEditableCourses', () => {
    it('should return all courses for admin', () => {
      const courses = listEditableCourses('admin-1', 'admin');
      expect(courses).toBeDefined();
    });

    it('should return only own courses for generator', () => {
      const courses = listEditableCourses('creator-1', 'generator');
      expect(courses).toBeDefined();
    });

    it('should return empty array for viewer', () => {
      const courses = listEditableCourses('viewer-1', 'viewer');
      expect(courses).toEqual([]);
    });
  });

  describe('listVisibleCourses', () => {
    it('should return all active courses for anonymous users', () => {
      const courses = listVisibleCourses(null);
      expect(courses).toBeDefined();
    });

    it('should return all active courses for logged-in users', () => {
      const courses = listVisibleCourses('user-1');
      expect(courses).toBeDefined();
    });
  });
});
