const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'database', 'openmaic.db');
const db = new Database(dbPath);

// 检查是否已有管理员账号
const existingAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();

if (existingAdmin) {
  console.log('管理员账号已存在:', existingAdmin.username);
  process.exit(0);
}

// 创建默认管理员账号
const hashedPassword = bcrypt.hashSync('admin123', 10);
const now = new Date().toISOString();

try {
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, display_name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'admin-' + Date.now(),
    'admin',
    'admin@openmaic.local',
    hashedPassword,
    'admin',
    '管理员',
    'active',
    now,
    now
  );
  console.log('✅ 默认管理员账号创建成功');
  console.log('   用户名: admin');
  console.log('   密码: admin123');
} catch (error) {
  console.error('❌ 创建失败:', error.message);
}

db.close();
