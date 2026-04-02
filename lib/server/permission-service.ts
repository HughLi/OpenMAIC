import { getDatabase } from '@/server/database';

/**
 * Check if a user can view a course
 * - All active courses are visible to everyone (including anonymous)
 */
export function canViewCourse(courseId: string, userId: string | null): boolean {
  const db = getDatabase();

  // Check if course exists and is active
  const course = db.prepare(
    'SELECT id, status FROM classrooms WHERE id = ?'
  ).get(courseId) as { id: string; status: string } | undefined;

  if (!course) return false;

  // All active courses are visible to everyone
  return course.status === 'active';
}

/**
 * Check if a user can manage (edit/delete) a course
 * - Admin can manage any course
 * - Generator can only manage their own courses
 * - Viewer cannot manage any course
 */
export function canManageCourse(
  courseId: string,
  userId: string,
  userRole: string
): boolean {
  // Admin can manage any course
  if (userRole === 'admin') {
    return true;
  }

  // Viewer cannot manage any course
  if (userRole === 'viewer') {
    return false;
  }

  // Generator can only manage their own courses
  if (userRole === 'generator') {
    const db = getDatabase();
    const course = db.prepare(
      'SELECT owner_id FROM classrooms WHERE id = ?'
    ).get(courseId) as { owner_id: string } | undefined;

    if (!course) return false;
    return course.owner_id === userId;
  }

  return false;
}

/**
 * Check course permission with detailed result
 */
export function checkCoursePermission(
  courseId: string,
  userId: string | null,
  userRole: string | null,
  action: 'view' | 'manage'
): { allowed: boolean; reason?: string } {
  if (action === 'view') {
    const allowed = canViewCourse(courseId, userId);
    return {
      allowed,
      reason: allowed ? undefined : '课程不存在或已下架',
    };
  }

  if (action === 'manage') {
    if (!userId || !userRole) {
      return { allowed: false, reason: '请先登录' };
    }

    const allowed = canManageCourse(courseId, userId, userRole);
    return {
      allowed,
      reason: allowed
        ? undefined
        : userRole === 'viewer'
        ? '您没有权限管理课程'
        : '只能管理自己创建的课程',
    };
  }

  return { allowed: false, reason: '未知操作' };
}

/**
 * List courses that a user can edit
 * - Admin: all courses
 * - Generator: only their own courses
 * - Viewer: empty array
 */
export function listEditableCourses(
  userId: string,
  userRole: string
): Array<{ id: string; title: string; status: string; created_by: string }> {
  const db = getDatabase();

  if (userRole === 'admin') {
    return db.prepare(
      `SELECT id, title, status, owner_id as created_by
       FROM classrooms
       ORDER BY created_at DESC`
    ).all() as Array<{ id: string; title: string; status: string; created_by: string }>;
  }

  if (userRole === 'generator') {
    return db.prepare(
      `SELECT id, title, status, owner_id as created_by
       FROM classrooms
       WHERE owner_id = ?
       ORDER BY created_at DESC`
    ).all(userId) as Array<{ id: string; title: string; status: string; created_by: string }>;
  }

  // Viewer cannot edit any course
  return [];
}

/**
 * List courses visible to a user
 * - All active courses are visible to everyone
 */
export function listVisibleCourses(
  userId: string | null
): Array<{ id: string; title: string; category: string; created_by: string }> {
  const db = getDatabase();

  // All active courses are visible to everyone
  return db.prepare(
    `SELECT c.id, c.title, c.category, c.owner_id as created_by, u.username as author_name
     FROM classrooms c
     LEFT JOIN users u ON c.owner_id = u.id
     WHERE c.status = 'active'
     ORDER BY c.created_at DESC`
  ).all() as Array<{ id: string; title: string; category: string; created_by: string }>;
}

/**
 * Check if a course is owned by a specific user
 */
export function isCourseOwner(courseId: string, userId: string): boolean {
  const db = getDatabase();
  const course = db.prepare(
    'SELECT owner_id FROM classrooms WHERE id = ?'
  ).get(courseId) as { owner_id: string } | undefined;

  return course?.owner_id === userId;
}

/**
 * Get course with permission info
 */
export function getCourseWithPermission(
  courseId: string,
  userId: string | null,
  userRole: string | null
): {
  course: { id: string; title: string; created_by: string } | null;
  canView: boolean;
  canManage: boolean;
} {
  const db = getDatabase();
  const course = db.prepare(
    'SELECT id, title, owner_id, status FROM classrooms WHERE id = ?'
  ).get(courseId) as { id: string; title: string; owner_id: string; status: string } | undefined;

  if (!course) {
    return { course: null, canView: false, canManage: false };
  }

  const canView = course.status === 'active';
  const canManage = userId && userRole
    ? canManageCourse(courseId, userId, userRole)
    : false;

  return {
    course: { id: course.id, title: course.title, created_by: course.owner_id },
    canView,
    canManage,
  };
}
