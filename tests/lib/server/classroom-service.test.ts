import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import {
  saveClassroomMetadata,
  getClassroomMetadata,
  listUserClassrooms,
  updateClassroom,
  deleteClassroom,
  isValidClassroomId,
  CLASSROOMS_DIR,
  CLASSROOM_MEDIA_DIR,
} from '@/lib/server/classroom-service';
import { closeDatabase, initializeSchema, getDatabase } from '@/server/database';
import type { ClassroomMetadata } from '@/lib/server/classroom-service';

// Test database path
const TEST_DB_DIR = join(tmpdir(), 'openmaic-test-' + Date.now());
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');

describe('classroom-service', () => {
  const testUserId = 'test-user-123';
  const testClassroomId = 'test-classroom-456';

  beforeAll(() => {
    // Set environment variable for test database path
    process.env.DATABASE_PATH = TEST_DB_PATH;

    // Ensure test directories exist
    if (!existsSync(TEST_DB_DIR)) {
      mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    if (!existsSync(CLASSROOMS_DIR)) {
      mkdirSync(CLASSROOMS_DIR, { recursive: true });
    }
    if (!existsSync(CLASSROOM_MEDIA_DIR)) {
      mkdirSync(CLASSROOM_MEDIA_DIR, { recursive: true });
    }

    // Initialize database using getDatabase() singleton
    const db = getDatabase();
    // Drop tables to ensure fresh schema (for testing only)
    db.exec(`DROP TABLE IF EXISTS classroom_access`);
    db.exec(`DROP TABLE IF EXISTS classroom_media`);
    db.exec(`DROP TABLE IF EXISTS classrooms`);
    db.exec(`DROP TABLE IF EXISTS refresh_tokens`);
    db.exec(`DROP TABLE IF EXISTS temporary_permissions`);
    db.exec(`DROP TABLE IF EXISTS permission_requests`);
    db.exec(`DROP TABLE IF EXISTS activity_logs`);
    db.exec(`DROP TABLE IF EXISTS users`);
    initializeSchema(db);

    // Create test users
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(testUserId, 'testuser', 'test@example.com', 'hash123', 'generator', 'active');
    insertUser.run('other-user', 'otheruser', 'other@example.com', 'hash456', 'viewer', 'active');
    insertUser.run('different-user', 'differentuser', 'different@example.com', 'hash789', 'viewer', 'active');
  });

  afterAll(() => {
    closeDatabase();
    // Clean up test directory
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
    delete process.env.DATABASE_PATH;
  });

  beforeEach(() => {
    // Clean up classrooms table before each test
    const db = getDatabase();
    db.prepare("DELETE FROM classrooms").run();
  });

  describe('isValidClassroomId', () => {
    it('should return true for valid IDs', () => {
      expect(isValidClassroomId('abc123')).toBe(true);
      expect(isValidClassroomId('test-classroom')).toBe(true);
      expect(isValidClassroomId('Test_123')).toBe(true);
    });

    it('should return false for invalid IDs', () => {
      expect(isValidClassroomId('')).toBe(false);
      expect(isValidClassroomId('test.classroom')).toBe(false);
      expect(isValidClassroomId('test classroom')).toBe(false);
      expect(isValidClassroomId('test@classroom')).toBe(false);
    });
  });

  describe('saveClassroomMetadata', () => {
    it('should save classroom metadata with all fields', () => {
      const metadata = {
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Test Classroom',
        description: 'A test classroom description',
        category: 'programming',
        coverImage: '/covers/test.jpg',
        visibility: 'public' as const,
        sceneCount: 5,
      };

      saveClassroomMetadata(metadata);

      const saved = getClassroomMetadata(testClassroomId);
      expect(saved).not.toBeNull();
      expect(saved?.title).toBe('Test Classroom');
      expect(saved?.description).toBe('A test classroom description');
      expect(saved?.category).toBe('programming');
      expect(saved?.coverImage).toBe('/covers/test.jpg');
      expect(saved?.visibility).toBe('public');
      expect(saved?.sceneCount).toBe(5);
      expect(saved?.ownerId).toBe(testUserId);
    });

    it('should save classroom with default values', () => {
      const metadata = {
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Minimal Classroom',
        sceneCount: 0,
      };

      saveClassroomMetadata(metadata);

      const saved = getClassroomMetadata(testClassroomId);
      expect(saved).not.toBeNull();
      expect(saved?.title).toBe('Minimal Classroom');
      expect(saved?.category).toBe('other');
      expect(saved?.coverImage).toBeNull();
      expect(saved?.visibility).toBe('private');
      expect(saved?.description).toBeNull();
    });

    it('should update existing classroom metadata', () => {
      // First save
      saveClassroomMetadata({
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Original Title',
        category: 'design',
        sceneCount: 1,
      });

      // Update
      saveClassroomMetadata({
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Updated Title',
        category: 'business',
        sceneCount: 2,
      });

      const saved = getClassroomMetadata(testClassroomId);
      expect(saved?.title).toBe('Updated Title');
      expect(saved?.category).toBe('business');
      expect(saved?.sceneCount).toBe(2);
    });
  });

  describe('getClassroomMetadata', () => {
    it('should return null for non-existent classroom', () => {
      const result = getClassroomMetadata('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return complete metadata for existing classroom', () => {
      const metadata = {
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Complete Classroom',
        description: 'Full description',
        category: 'data-science',
        coverImage: 'https://example.com/cover.jpg',
        visibility: 'shared' as const,
        sceneCount: 10,
      };

      saveClassroomMetadata(metadata);

      const saved = getClassroomMetadata(testClassroomId);
      expect(saved).toMatchObject({
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Complete Classroom',
        description: 'Full description',
        category: 'data-science',
        coverImage: 'https://example.com/cover.jpg',
        visibility: 'shared',
        sceneCount: 10,
        status: 'active',
      });
      expect(saved?.createdAt).toBeDefined();
      expect(saved?.updatedAt).toBeDefined();
    });
  });

  describe('listUserClassrooms', () => {
    it('should return empty array for user with no classrooms', () => {
      const classrooms = listUserClassrooms('user-with-no-classrooms');
      expect(classrooms).toEqual([]);
    });

    it('should return only active classrooms for a user', () => {
      // Create multiple classrooms
      saveClassroomMetadata({
        id: 'classroom-1',
        ownerId: testUserId,
        title: 'Classroom 1',
        category: 'programming',
        sceneCount: 1,
      });

      saveClassroomMetadata({
        id: 'classroom-2',
        ownerId: testUserId,
        title: 'Classroom 2',
        category: 'design',
        sceneCount: 2,
      });

      // Create classroom for another user
      saveClassroomMetadata({
        id: 'classroom-3',
        ownerId: 'other-user',
        title: 'Other User Classroom',
        sceneCount: 1,
      });

      const classrooms = listUserClassrooms(testUserId);
      expect(classrooms).toHaveLength(2);
      expect(classrooms.map(c => c.id)).toContain('classroom-1');
      expect(classrooms.map(c => c.id)).toContain('classroom-2');
      expect(classrooms.map(c => c.id)).not.toContain('classroom-3');
    });

    it('should sort classrooms by updated_at descending', async () => {
      saveClassroomMetadata({
        id: 'older-classroom',
        ownerId: testUserId,
        title: 'Older Classroom',
        sceneCount: 1,
      });

      // Delay to ensure different timestamps (SQLite datetime is second-precision)
      await new Promise(resolve => setTimeout(resolve, 1100));

      saveClassroomMetadata({
        id: 'newer-classroom',
        ownerId: testUserId,
        title: 'Newer Classroom',
        sceneCount: 1,
      });

      const classrooms = listUserClassrooms(testUserId);
      expect(classrooms).toHaveLength(2);
      // Verify both exist and newer is first (due to updated_at DESC)
      expect(classrooms[0].id).toBe('newer-classroom');
      expect(classrooms[1].id).toBe('older-classroom');
    });

    it('should include category and coverImage in results', () => {
      saveClassroomMetadata({
        id: 'detailed-classroom',
        ownerId: testUserId,
        title: 'Detailed Classroom',
        category: 'business',
        coverImage: '/path/to/cover.png',
        sceneCount: 5,
      });

      const classrooms = listUserClassrooms(testUserId);
      expect(classrooms).toHaveLength(1);
      expect(classrooms[0].category).toBe('business');
      expect(classrooms[0].coverImage).toBe('/path/to/cover.png');
    });
  });

  describe('updateClassroom', () => {
    beforeEach(() => {
      saveClassroomMetadata({
        id: testClassroomId,
        ownerId: testUserId,
        title: 'Original Title',
        description: 'Original description',
        category: 'programming',
        coverImage: '/original/cover.jpg',
        visibility: 'private' as const,
        sceneCount: 3,
      });
    });

    it('should update title', () => {
      const result = updateClassroom(testClassroomId, testUserId, {
        title: 'New Title',
      });
      expect(result).toBe(true);

      const updated = getClassroomMetadata(testClassroomId);
      expect(updated?.title).toBe('New Title');
      expect(updated?.description).toBe('Original description'); // Unchanged
    });

    it('should update category', () => {
      const result = updateClassroom(testClassroomId, testUserId, {
        category: 'data-science',
      });
      expect(result).toBe(true);

      const updated = getClassroomMetadata(testClassroomId);
      expect(updated?.category).toBe('data-science');
    });

    it('should update coverImage', () => {
      const result = updateClassroom(testClassroomId, testUserId, {
        coverImage: '/new/cover.png',
      });
      expect(result).toBe(true);

      const updated = getClassroomMetadata(testClassroomId);
      expect(updated?.coverImage).toBe('/new/cover.png');
    });

    it('should update multiple fields at once', () => {
      const result = updateClassroom(testClassroomId, testUserId, {
        title: 'Updated Title',
        description: 'Updated description',
        category: 'design',
        coverImage: '/updated/cover.webp',
        visibility: 'public',
      });
      expect(result).toBe(true);

      const updated = getClassroomMetadata(testClassroomId);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.category).toBe('design');
      expect(updated?.coverImage).toBe('/updated/cover.webp');
      expect(updated?.visibility).toBe('public');
    });

    it('should return false for non-existent classroom', () => {
      const result = updateClassroom('non-existent', testUserId, {
        title: 'New Title',
      });
      expect(result).toBe(false);
    });

    it('should return false for unauthorized user', () => {
      const result = updateClassroom(testClassroomId, 'different-user', {
        title: 'Hacked Title',
      });
      expect(result).toBe(false);

      // Verify classroom was not modified
      const unchanged = getClassroomMetadata(testClassroomId);
      expect(unchanged?.title).toBe('Original Title');
    });

    it('should update sceneCount', () => {
      const result = updateClassroom(testClassroomId, testUserId, {
        sceneCount: 10,
      });
      expect(result).toBe(true);

      const updated = getClassroomMetadata(testClassroomId);
      expect(updated?.sceneCount).toBe(10);
    });
  });

  describe('deleteClassroom', () => {
    it('should soft delete classroom', async () => {
      saveClassroomMetadata({
        id: testClassroomId,
        ownerId: testUserId,
        title: 'To be deleted',
        sceneCount: 1,
      });

      const result = await deleteClassroom(testClassroomId);
      expect(result).toBe(true);

      // Should not appear in list
      const classrooms = listUserClassrooms(testUserId);
      expect(classrooms).toHaveLength(0);

      // But metadata should still exist with deleted status
      const db = getDatabase();
      const record = db.prepare('SELECT status FROM classrooms WHERE id = ?').get(testClassroomId) as
        | { status: string }
        | undefined;
      expect(record?.status).toBe('deleted');
    });

    it('should return false for non-existent classroom', async () => {
      const result = await deleteClassroom('non-existent');
      expect(result).toBe(false);
    });
  });
});