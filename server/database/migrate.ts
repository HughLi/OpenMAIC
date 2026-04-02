#!/usr/bin/env ts-node
import { getDatabase, initializeSchema } from './index.js';

/**
 * Database migration script
 * Run with: npx ts-node server/database/migrate.ts
 */

function migrate() {
  const db = getDatabase();

  console.log('Starting database migration...');

  // Check if migration has already been run
  const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='course_categories'").get();
  if (tableInfo) {
    console.log('Migration already applied (course_categories table exists)');
    return;
  }

  // Migration 1: Update users.status to support new values
  console.log('Migration 1: Updating users.status column...');
  try {
    // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    db.exec(`
      -- Create temporary table with new schema
      CREATE TABLE users_new (
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

      -- Copy data from old table, converting 'pending' to 'pending_approval', 'active' to 'active', 'inactive' to 'inactive'
      INSERT INTO users_new SELECT * FROM users;

      -- Update existing 'active' users to remain 'active' (migration sets default to pending_approval)
      UPDATE users_new SET status = 'active' WHERE status = 'active';

      -- Drop old table
      DROP TABLE users;

      -- Rename new table
      ALTER TABLE users_new RENAME TO users;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    `);
    console.log('✓ users table updated successfully');
  } catch (error) {
    console.error('✗ Failed to update users table:', error);
    throw error;
  }

  // Migration 2: Create course_categories table
  console.log('Migration 2: Creating course_categories table...');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_categories (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_course_categories_sort ON course_categories(sort_order);
      CREATE INDEX IF NOT EXISTS idx_course_categories_active ON course_categories(is_active);
    `);
    console.log('✓ course_categories table created');
  } catch (error) {
    console.error('✗ Failed to create course_categories table:', error);
    throw error;
  }

  // Migration 3: Create admin_actions table
  console.log('Migration 3: Creating admin_actions table...');
  try {
    db.exec(`
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
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
      CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);
    `);
    console.log('✓ admin_actions table created');
  } catch (error) {
    console.error('✗ Failed to create admin_actions table:', error);
    throw error;
  }

  // Migration 4: Create user_role_history table
  console.log('Migration 4: Creating user_role_history table...');
  try {
    db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_user_role_history_user_id ON user_role_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_role_history_created_at ON user_role_history(created_at);
    `);
    console.log('✓ user_role_history table created');
  } catch (error) {
    console.error('✗ Failed to create user_role_history table:', error);
    throw error;
  }

  // Migration 5: Create notifications table
  console.log('Migration 5: Creating notifications table...');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('system', 'approval', 'course_status', 'role_change')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        read_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
    `);
    console.log('✓ notifications table created');
  } catch (error) {
    console.error('✗ Failed to create notifications table:', error);
    throw error;
  }

  console.log('\n✅ Database migration completed successfully!');
}

// Run migration if this file is executed directly
if (require.main === module) {
  try {
    migrate();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

export { migrate };
