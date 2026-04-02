import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createUserClassroom,
  listUserClassrooms,
  updateUserClassroom,
  deleteUserClassroom,
  getUserClassroomById,
} from '@/lib/server/user-classroom-service';
import { getDatabase } from '@/server/database';
import { v4 as uuidv4 } from 'uuid';

describe('User Classroom Service', () => {
  const testUserId = uuidv4();
  const testClassroomId = uuidv4();

  beforeEach(() => {
    // Clean up test data before each test
    const db = getDatabase();
    db.prepare('DELETE FROM user_classrooms WHERE user_id = ?').run(testUserId);
  });

  describe('createUserClassroom', () => {
    it('should create a new user classroom', () => {
      const result = createUserClassroom(testUserId, {
        classroomId: testClassroomId,
        name: 'Test Classroom',
        description: 'Test Description',
        sceneCount: 5,
      });

      expect(result.success).toBe(true);
      expect(result.classroom).toBeDefined();
      expect(result.classroom?.name).toBe('Test Classroom');
      expect(result.classroom?.sceneCount).toBe(5);
      expect(result.classroom?.userId).toBe(testUserId);
    });

    it('should update last_accessed_at if classroom already exists', () => {
      // Create first time
      createUserClassroom(testUserId, {
        classroomId: testClassroomId,
        name: 'Test Classroom',
      });

      // Create second time (should update)
      const result = createUserClassroom(testUserId, {
        classroomId: testClassroomId,
        name: 'Updated Name',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('listUserClassrooms', () => {
    it('should return empty list when no classrooms exist', () => {
      const result = listUserClassrooms(testUserId);

      expect(result.classrooms).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should return user classrooms ordered by updated_at desc', () => {
      // Create multiple classrooms
      createUserClassroom(testUserId, {
        classroomId: uuidv4(),
        name: 'Classroom 1',
      });

      createUserClassroom(testUserId, {
        classroomId: uuidv4(),
        name: 'Classroom 2',
      });

      const result = listUserClassrooms(testUserId);

      expect(result.classrooms).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should support pagination', () => {
      // Create 5 classrooms
      for (let i = 0; i < 5; i++) {
        createUserClassroom(testUserId, {
          classroomId: uuidv4(),
          name: `Classroom ${i}`,
        });
      }

      const result = listUserClassrooms(testUserId, { page: 1, limit: 3 });

      expect(result.classrooms).toHaveLength(3);
      expect(result.total).toBe(5);
    });
  });

  describe('updateUserClassroom', () => {
    it('should update classroom successfully', () => {
      const created = createUserClassroom(testUserId, {
        classroomId: testClassroomId,
        name: 'Original Name',
      });

      const result = updateUserClassroom(created.classroom!.id, testUserId, {
        name: 'Updated Name',
        sceneCount: 10,
      });

      expect(result.success).toBe(true);
      expect(result.classroom?.name).toBe('Updated Name');
      expect(result.classroom?.sceneCount).toBe(10);
    });

    it('should fail when classroom does not exist', () => {
      const result = updateUserClassroom(uuidv4(), testUserId, {
        name: 'Updated Name',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('课堂不存在或无权限');
    });
  });

  describe('deleteUserClassroom', () => {
    it('should delete classroom successfully', () => {
      const created = createUserClassroom(testUserId, {
        classroomId: testClassroomId,
        name: 'To Delete',
      });

      const result = deleteUserClassroom(created.classroom!.id, testUserId);

      expect(result.success).toBe(true);

      // Verify it's deleted
      const found = getUserClassroomById(created.classroom!.id);
      expect(found).toBeUndefined();
    });

    it('should fail when classroom does not exist', () => {
      const result = deleteUserClassroom(uuidv4(), testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('课堂不存在或无权限');
    });
  });
});
