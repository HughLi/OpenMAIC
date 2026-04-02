-- OpenMAIC Account System Database Schema
-- Role-based access control with user management

-- Users table
-- status: pending_approval = 等待审批, active = 正常, inactive = 被冻结, rejected = 已拒绝
-- role: admin = 管理员, generator = 生产者/教师, viewer = 学习者/学生
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'generator', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval', 'active', 'inactive', 'rejected')),
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  login_count INTEGER DEFAULT 0
);

-- Permission requests table (for viewers requesting generator access)
CREATE TABLE IF NOT EXISTS permission_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK(request_type IN ('generator_upgrade', 'temporary_generator')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  expires_at TEXT,  -- for temporary permissions
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Temporary permissions table (active time-limited generator access)
CREATE TABLE IF NOT EXISTS temporary_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  max_generations INTEGER DEFAULT 10,
  generations_used INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Classrooms table (metadata only, actual data stored in filesystem)
CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'other',
  cover_image TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'public', 'shared')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
  scene_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  storage_path TEXT, -- Path to classroom data file (user-isolated storage)
  sync_status TEXT DEFAULT 'local' CHECK(sync_status IN ('local', 'syncing', 'synced', 'error')), -- Cloud sync state
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Classroom access grants (for sharing with specific viewers)
CREATE TABLE IF NOT EXISTS classroom_access (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL,
  user_id TEXT,
  access_type TEXT NOT NULL DEFAULT 'view' CHECK(access_type IN ('view', 'edit')),
  access_code TEXT,  -- for non-registered users
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Classroom media files (audio, images)
CREATE TABLE IF NOT EXISTS classroom_media (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('audio', 'image', 'video')),
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  duration INTEGER,  -- for audio/video in seconds
  metadata TEXT,  -- JSON string for additional metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

-- Refresh tokens for JWT
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details TEXT,  -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Course categories table (managed by admin)
CREATE TABLE IF NOT EXISTS course_categories (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin action logs table
CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN (
    'approve_user', 'reject_user', 'freeze_user', 'unfreeze_user',
    'delete_user', 'role_change', 'course_offline', 'course_online',
    'course_delete', 'category_create', 'category_delete'
  )),
  target_type TEXT NOT NULL CHECK(target_type IN ('user', 'course', 'category')),
  target_id TEXT NOT NULL,
  details TEXT, -- JSON string for additional data
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User role change history
CREATE TABLE IF NOT EXISTS user_role_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  old_role TEXT NOT NULL CHECK(old_role IN ('admin', 'generator', 'viewer')),
  new_role TEXT NOT NULL CHECK(new_role IN ('admin', 'generator', 'viewer')),
  changed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Notifications table (站内信)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('system', 'approval', 'course_status', 'role_change')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  data TEXT, -- JSON string for additional context
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_course_categories_sort ON course_categories(sort_order);
CREATE INDEX IF NOT EXISTS idx_course_categories_active ON course_categories(is_active);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);

CREATE INDEX IF NOT EXISTS idx_user_role_history_user_id ON user_role_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_history_created_at ON user_role_history(created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_permission_requests_user_id ON permission_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_permission_requests_status ON permission_requests(status);

CREATE INDEX IF NOT EXISTS idx_temp_permissions_user_id ON temporary_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_permissions_expires ON temporary_permissions(expires_at);

CREATE INDEX IF NOT EXISTS idx_classrooms_owner_id ON classrooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_visibility ON classrooms(visibility);
CREATE INDEX IF NOT EXISTS idx_classrooms_category ON classrooms(category);
CREATE INDEX IF NOT EXISTS idx_classrooms_storage_path ON classrooms(storage_path);
CREATE INDEX IF NOT EXISTS idx_classrooms_sync_status ON classrooms(sync_status);

CREATE INDEX IF NOT EXISTS idx_classroom_access_classroom_id ON classroom_access(classroom_id);
CREATE INDEX IF NOT EXISTS idx_classroom_access_user_id ON classroom_access(user_id);

CREATE INDEX IF NOT EXISTS idx_classroom_media_classroom_id ON classroom_media(classroom_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);

-- User classrooms table (for recent learning tracking)
CREATE TABLE IF NOT EXISTS user_classrooms (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  classroom_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  scene_count INTEGER DEFAULT 0,
  cover_image TEXT,
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  UNIQUE(user_id, classroom_id)
);

-- Indexes for user_classrooms
CREATE INDEX IF NOT EXISTS idx_user_classrooms_user_id ON user_classrooms(user_id);
CREATE INDEX IF NOT EXISTS idx_user_classrooms_classroom_id ON user_classrooms(classroom_id);
CREATE INDEX IF NOT EXISTS idx_user_classrooms_updated_at ON user_classrooms(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_classrooms_accessed_at ON user_classrooms(user_id, last_accessed_at DESC);
