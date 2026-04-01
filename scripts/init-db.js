#!/usr/bin/env node

/**
 * Database initialization script
 * Creates database schema and default admin account
 *
 * Usage: node scripts/init-db.js
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'database', 'openmaic.db');
const SCHEMA_PATH = path.join(process.cwd(), 'server', 'database', 'schema.sql');

const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'admin123',
  email: 'admin@openmaic.local',
  displayName: 'Administrator'
};

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function createDatabase() {
  const dbDir = path.dirname(DEFAULT_DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(DEFAULT_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initializeSchema(db) {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema file not found: ${SCHEMA_PATH}`);
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
}

async function init() {
  console.log('🚀 Initializing OpenMAIC database...\n');

  try {
    console.log('📁 Creating database...');
    const db = createDatabase();
    console.log('✅ Database created\n');

    console.log('📋 Initializing schema...');
    initializeSchema(db);
    console.log('✅ Schema initialized\n');

    const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
    if (existingAdmin) {
      console.log('⚠️  Admin account already exists, skipping creation\n');
    } else {
      console.log('👤 Creating default admin account...');
      const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
      const userId = uuidv4();

      db.prepare(`
        INSERT INTO users (id, username, email, password_hash, role, display_name, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        DEFAULT_ADMIN.username,
        DEFAULT_ADMIN.email,
        passwordHash,
        'admin',
        DEFAULT_ADMIN.displayName,
        'active'
      );

      console.log('✅ Admin account created\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Default Admin Credentials:');
      console.log('  Username: admin');
      console.log('  Password: admin123');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n⚠️  IMPORTANT: Please change the password after first login!\n');
    }

    db.close();
    console.log('🎉 Database initialization complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  }
}

init();
