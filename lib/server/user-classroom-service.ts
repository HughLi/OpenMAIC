import { getDatabase } from '@/server/database';
import type { UserClassroom, CreateUserClassroomInput, UpdateUserClassroomInput } from '@/lib/types/user-classroom';
import { v4 as uuidv4 } from 'uuid';

interface CreateResult {
  success: boolean;
  classroom?: UserClassroom;
  error?: string;
}

interface UpdateResult {
  success: boolean;
  classroom?: UserClassroom;
  error?: string;
}

interface DeleteResult {
  success: boolean;
  error?: string;
}

interface ListResult {
  classrooms: UserClassroom[];
  total: number;
}

export function createUserClassroom(
  userId: string,
  input: CreateUserClassroomInput
): CreateResult {
  const db = getDatabase();

  // Check if already exists
  const existing = db.prepare(
    'SELECT id FROM user_classrooms WHERE user_id = ? AND classroom_id = ?'
  ).get(userId, input.classroomId) as { id: string } | undefined;

  if (existing) {
    // Update last_accessed_at if exists
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE user_classrooms
       SET last_accessed_at = ?, updated_at = ?
       WHERE user_id = ? AND classroom_id = ?`
    ).run(now, now, userId, input.classroomId);

    const updated = getUserClassroomById(existing.id);
    return { success: true, classroom: updated };
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  const classroom: UserClassroom = {
    id,
    userId,
    classroomId: input.classroomId,
    name: input.name,
    description: input.description,
    sceneCount: input.sceneCount ?? 0,
    coverImage: input.coverImage,
    lastAccessedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO user_classrooms
     (id, user_id, classroom_id, name, description, scene_count, cover_image, last_accessed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    classroom.id,
    classroom.userId,
    classroom.classroomId,
    classroom.name,
    classroom.description ?? null,
    classroom.sceneCount,
    classroom.coverImage ?? null,
    classroom.lastAccessedAt,
    classroom.createdAt,
    classroom.updatedAt
  );

  return { success: true, classroom };
}

export function getUserClassroomById(id: string): UserClassroom | undefined {
  const db = getDatabase();

  const row = db.prepare(
    `SELECT id, user_id, classroom_id, name, description, scene_count, cover_image,
            last_accessed_at, created_at, updated_at
     FROM user_classrooms WHERE id = ?`
  ).get(id) as {
    id: string;
    user_id: string;
    classroom_id: string;
    name: string;
    description: string | null;
    scene_count: number;
    cover_image: string | null;
    last_accessed_at: string;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) return undefined;

  return {
    id: row.id,
    userId: row.user_id,
    classroomId: row.classroom_id,
    name: row.name,
    description: row.description ?? undefined,
    sceneCount: row.scene_count,
    coverImage: row.cover_image ?? undefined,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listUserClassrooms(
  userId: string,
  options: { page?: number; limit?: number; search?: string; userRole?: string } = {}
): ListResult {
  const db = getDatabase();
  const { page = 1, limit = 20, search, userRole = 'viewer' } = options;

  // Join with classrooms table to check visibility
  let whereClause = 'WHERE uc.user_id = ?';
  const params: (string | number)[] = [userId];

  // Filter by visibility based on user role
  if (userRole === 'viewer') {
    // Viewers can only see public courses
    whereClause += ` AND (c.visibility = 'public' OR c.visibility IS NULL)`;
  } else if (userRole === 'generator') {
    // Generators can see public courses + their own private courses
    whereClause += ` AND (c.visibility = 'public' OR c.visibility IS NULL OR c.owner_id = ?)`;
    params.push(userId);
  }
  // Admin can see all courses (no visibility filter)

  if (search) {
    whereClause += ' AND (uc.name LIKE ? OR uc.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Get total count with join
  const countResult = db.prepare(
    `SELECT COUNT(*) as total
     FROM user_classrooms uc
     LEFT JOIN classrooms c ON uc.classroom_id = c.id
     ${whereClause}`
  ).get(...params) as { total: number };

  // Get paginated results with join
  const offset = (page - 1) * limit;
  const rows = db.prepare(
    `SELECT uc.id, uc.user_id, uc.classroom_id, uc.name, uc.description, uc.scene_count, uc.cover_image,
            uc.last_accessed_at, uc.created_at, uc.updated_at
     FROM user_classrooms uc
     LEFT JOIN classrooms c ON uc.classroom_id = c.id
     ${whereClause}
     ORDER BY uc.updated_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Array<{
    id: string;
    user_id: string;
    classroom_id: string;
    name: string;
    description: string | null;
    scene_count: number;
    cover_image: string | null;
    last_accessed_at: string;
    created_at: string;
    updated_at: string;
  }>;

  const classrooms = rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    classroomId: row.classroom_id,
    name: row.name,
    description: row.description ?? undefined,
    sceneCount: row.scene_count,
    coverImage: row.cover_image ?? undefined,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { classrooms, total: countResult.total };
}

export function updateUserClassroom(
  id: string,
  userId: string,
  input: UpdateUserClassroomInput
): UpdateResult {
  const db = getDatabase();

  // Check if exists and belongs to user
  const existing = db.prepare(
    'SELECT id FROM user_classrooms WHERE id = ? AND user_id = ?'
  ).get(id, userId) as { id: string } | undefined;

  if (!existing) {
    return { success: false, error: '课堂不存在或无权限' };
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description ?? null);
  }
  if (input.sceneCount !== undefined) {
    updates.push('scene_count = ?');
    values.push(input.sceneCount);
  }
  if (input.coverImage !== undefined) {
    updates.push('cover_image = ?');
    values.push(input.coverImage ?? null);
  }
  if (input.lastAccessedAt !== undefined) {
    updates.push('last_accessed_at = ?');
    values.push(input.lastAccessedAt);
  }

  if (updates.length === 0) {
    return { success: true, classroom: getUserClassroomById(id) };
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  values.push(userId);

  db.prepare(
    `UPDATE user_classrooms SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values);

  return { success: true, classroom: getUserClassroomById(id) };
}

export function deleteUserClassroom(id: string, userId: string): DeleteResult {
  const db = getDatabase();

  const result = db.prepare(
    'DELETE FROM user_classrooms WHERE id = ? AND user_id = ?'
  ).run(id, userId);

  if (result.changes === 0) {
    return { success: false, error: '课堂不存在或无权限' };
  }

  return { success: true };
}

export function touchUserClassroom(userId: string, classroomId: string): boolean {
  const db = getDatabase();

  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE user_classrooms
     SET last_accessed_at = ?, updated_at = ?
     WHERE user_id = ? AND classroom_id = ?`
  ).run(now, now, userId, classroomId);

  return result.changes > 0;
}
