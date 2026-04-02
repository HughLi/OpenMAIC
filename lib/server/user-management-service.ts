import { getDatabase } from '@/server/database';
import type { User, UserRole, UserStatus } from '@/lib/types/user';

export interface UserListFilters {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
}

export interface UserListResult {
  users: User[];
  total: number;
}

export interface UserActionResult {
  success: boolean;
  error?: string;
  user?: User;
}

/**
 * List users with filters (admin only)
 */
export function listUsers(
  filters: UserListFilters = {},
  page: number = 1,
  limit: number = 20
): UserListResult {
  const db = getDatabase();

  let whereClause = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (filters.role) {
    whereClause += ' AND role = ?';
    params.push(filters.role);
  }

  if (filters.status) {
    whereClause += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.search) {
    whereClause += ' AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)';
    const searchPattern = `%${filters.search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Get total count
  const countResult = db.prepare(
    `SELECT COUNT(*) as total FROM users ${whereClause}`
  ).get(...params) as { total: number };

  // Get users with pagination
  const offset = (page - 1) * limit;
  const users = db.prepare(
    `SELECT id, username, email, role, status, display_name, created_at, updated_at, last_login_at, login_count
     FROM users ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as User[];

  return { users, total: countResult.total };
}

/**
 * Get user by ID
 */
export function getUserById(id: string): User | undefined {
  const db = getDatabase();

  return db.prepare(
    `SELECT id, username, email, role, status, display_name, created_at, updated_at, last_login_at, login_count
     FROM users WHERE id = ?`
  ).get(id) as User | undefined;
}

/**
 * Approve a pending user
 */
export function approveUser(userId: string, adminId: string): UserActionResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  if (user.status !== 'pending_approval') {
    return { success: false, error: '用户不是待审批状态' };
  }

  try {
    db.prepare(
      `UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?`
    ).run(userId);

    // Log admin action
    db.prepare(
      `INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, ?, 'approve_user', 'user', ?, ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      adminId,
      userId,
      JSON.stringify({ previous_status: 'pending_approval' })
    );

    // Create notification for user
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, content, created_at)
       VALUES (?, ?, 'approval', '账户已审批通过', '您的账户已通过管理员审批，现在可以正常使用系统功能。', datetime('now'))`
    ).run(crypto.randomUUID(), userId);

    return { success: true, user: getUserById(userId) };
  } catch (error) {
    return { success: false, error: '审批失败: ' + String(error) };
  }
}

/**
 * Reject a pending user
 */
export function rejectUser(userId: string, adminId: string, reason?: string): UserActionResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  if (user.status !== 'pending_approval') {
    return { success: false, error: '用户不是待审批状态' };
  }

  try {
    db.prepare(
      `UPDATE users SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`
    ).run(userId);

    // Log admin action
    db.prepare(
      `INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, ?, 'reject_user', 'user', ?, ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      adminId,
      userId,
      JSON.stringify({ reason })
    );

    return { success: true, user: getUserById(userId) };
  } catch (error) {
    return { success: false, error: '拒绝失败: ' + String(error) };
  }
}

/**
 * Freeze/Deactivate a user
 */
export function freezeUser(userId: string, adminId: string, reason?: string): UserActionResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  if (user.status === 'inactive') {
    return { success: false, error: '用户已被冻结' };
  }

  try {
    db.prepare(
      `UPDATE users SET status = 'inactive', updated_at = datetime('now') WHERE id = ?`
    ).run(userId);

    // Log admin action
    db.prepare(
      `INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, ?, 'freeze_user', 'user', ?, ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      adminId,
      userId,
      JSON.stringify({ reason, previous_status: user.status })
    );

    // Create notification for user
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, content, created_at)
       VALUES (?, ?, 'system', '账户已被冻结', '您的账户已被管理员冻结。如有疑问，请联系管理员。', datetime('now'))`
    ).run(crypto.randomUUID(), userId);

    return { success: true, user: getUserById(userId) };
  } catch (error) {
    return { success: false, error: '冻结失败: ' + String(error) };
  }
}

/**
 * Unfreeze/Reactivate a user
 */
export function unfreezeUser(userId: string, adminId: string): UserActionResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  if (user.status !== 'inactive') {
    return { success: false, error: '用户未被冻结' };
  }

  try {
    db.prepare(
      `UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?`
    ).run(userId);

    // Log admin action
    db.prepare(
      `INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, ?, 'unfreeze_user', 'user', ?, ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      adminId,
      userId,
      JSON.stringify({ previous_status: 'inactive' })
    );

    // Create notification for user
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, content, created_at)
       VALUES (?, ?, 'system', '账户已解冻', '您的账户已恢复正常，现在可以登录使用。', datetime('now'))`
    ).run(crypto.randomUUID(), userId);

    return { success: true, user: getUserById(userId) };
  } catch (error) {
    return { success: false, error: '解冻失败: ' + String(error) };
  }
}

/**
 * Change user role
 */
export function changeUserRole(
  userId: string,
  newRole: UserRole,
  adminId: string,
  reason?: string
): UserActionResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  if (user.role === newRole) {
    return { success: false, error: '用户已经是该角色' };
  }

  // Prevent changing admin role
  if (user.role === 'admin' && newRole !== 'admin') {
    const adminCount = db.prepare(
      "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'active'"
    ).get() as { count: number };

    if (adminCount.count <= 1) {
      return { success: false, error: '不能修改唯一管理员的角色' };
    }
  }

  const oldRole = user.role;

  try {
    db.prepare(
      `UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newRole, userId);

    // Log role change history
    db.prepare(
      `INSERT INTO user_role_history (id, user_id, old_role, new_role, changed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(crypto.randomUUID(), userId, oldRole, newRole, adminId, reason || null);

    // Log admin action
    db.prepare(
      `INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, ?, 'role_change', 'user', ?, ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      adminId,
      userId,
      JSON.stringify({ old_role: oldRole, new_role: newRole, reason })
    );

    // Create notification for user
    const roleNameMap: Record<UserRole, string> = {
      admin: '管理员',
      generator: '生产者',
      viewer: '学习者',
    };

    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, content, created_at)
       VALUES (?, ?, 'role_change', '角色已变更', ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      userId,
      `您的角色已变更为「${roleNameMap[newRole]}」。如有疑问，请联系管理员。`
    );

    return { success: true, user: getUserById(userId) };
  } catch (error) {
    return { success: false, error: '角色变更失败: ' + String(error) };
  }
}

/**
 * Soft delete user (set status to deleted)
 */
export function deleteUser(userId: string, adminId: string): UserActionResult {
  const db = getDatabase();

  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  // Prevent deleting the last admin
  if (user.role === 'admin') {
    const adminCount = db.prepare(
      "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'active'"
    ).get() as { count: number };

    if (adminCount.count <= 1) {
      return { success: false, error: '不能删除唯一的管理员' };
    }
  }

  try {
    db.prepare(
      `UPDATE users SET status = 'inactive', updated_at = datetime('now') WHERE id = ?`
    ).run(userId);

    // Log admin action
    db.prepare(
      `INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, ?, 'delete_user', 'user', ?, ?, datetime('now'))`
    ).run(
      crypto.randomUUID(),
      adminId,
      userId,
      JSON.stringify({ previous_status: user.status })
    );

    return { success: true };
  } catch (error) {
    return { success: false, error: '删除失败: ' + String(error) };
  }
}

/**
 * Get pending approval users count
 */
export function getPendingApprovalCount(): number {
  const db = getDatabase();

  const result = db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE status = 'pending_approval'"
  ).get() as { count: number };

  return result.count;
}

/**
 * Get user statistics
 */
export function getUserStatistics(): {
  total: number;
  active: number;
  pending: number;
  inactive: number;
  byRole: Record<UserRole, number>;
} {
  const db = getDatabase();

  const total = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const active = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get() as { count: number };
  const pending = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending_approval'").get() as { count: number };
  const inactive = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'inactive'").get() as { count: number };

  const byRole: Record<UserRole, number> = {
    admin: (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }).count,
    generator: (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'generator'").get() as { count: number }).count,
    viewer: (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'viewer'").get() as { count: number }).count,
  };

  return {
    total: total.count,
    active: active.count,
    pending: pending.count,
    inactive: inactive.count,
    byRole,
  };
}
