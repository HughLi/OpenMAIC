-- OpenMAIC Account System Database Schema
-- Role-based access control with user management

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'generator', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'pending')),
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
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'public', 'shared')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
  scene_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_permission_requests_user_id ON permission_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_permission_requests_status ON permission_requests(status);

CREATE INDEX IF NOT EXISTS idx_temp_permissions_user_id ON temporary_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_permissions_expires ON temporary_permissions(expires_at);

CREATE INDEX IF NOT EXISTS idx_classrooms_owner_id ON classrooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_visibility ON classrooms(visibility);

CREATE INDEX IF NOT EXISTS idx_classroom_access_classroom_id ON classroom_access(classroom_id);
CREATE INDEX IF NOT EXISTS idx_classroom_access_user_id ON classroom_access(user_id);

CREATE INDEX IF NOT EXISTS idx_classroom_media_classroom_id ON classroom_media(classroom_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
