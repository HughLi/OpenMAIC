const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'database', 'openmaic.db');
const db = new Database(dbPath);

// 重置管理员密码
const hashedPassword = bcrypt.hashSync('admin123', 10);
const now = new Date().toISOString();

try {
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?, updated_at = ?
    WHERE username = 'admin'
  `).run(hashedPassword, now);

  if (result.changes > 0) {
    console.log('✅ 管理员密码已重置');
    console.log('   用户名: admin');
    console.log('   密码: admin123');
  } else {
    console.log('❌ 未找到 admin 账号');
  }
} catch (error) {
  console.error('❌ 重置失败:', error.message);
}

db.close();
