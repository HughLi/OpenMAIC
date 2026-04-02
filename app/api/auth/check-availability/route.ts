import { type NextRequest } from 'next/server';
import { getDatabase } from '@/server/database';

// GET /api/auth/check-availability?type=username&value=xxx
// GET /api/auth/check-availability?type=email&value=xxx
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const value = searchParams.get('value');

  if (!type || !value) {
    return Response.json(
      { available: false, message: '缺少参数' },
      { status: 400 }
    );
  }

  if (type !== 'username' && type !== 'email') {
    return Response.json(
      { available: false, message: '无效的查询类型' },
      { status: 400 }
    );
  }

  try {
    const db = getDatabase();

    let query: string;
    let exists: { count: number } | undefined;

    if (type === 'username') {
      // Validate username format
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(value)) {
        return Response.json({
          available: false,
          message: '用户名格式不正确',
        });
      }

      query = 'SELECT COUNT(*) as count FROM users WHERE username = ?';
      exists = db.prepare(query).get(value) as { count: number } | undefined;
    } else {
      // Validate email format
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return Response.json({
          available: false,
          message: '邮箱格式不正确',
        });
      }

      query = 'SELECT COUNT(*) as count FROM users WHERE email = ?';
      exists = db.prepare(query).get(value) as { count: number } | undefined;
    }

    const isAvailable = exists?.count === 0;

    return Response.json({
      available: isAvailable,
      message: isAvailable
        ? (type === 'username' ? '用户名可用' : '邮箱可用')
        : (type === 'username' ? '用户名已被使用' : '邮箱已被注册'),
    });
  } catch (error) {
    console.error('Check availability error:', error);
    return Response.json(
      { available: false, message: '检查失败，请稍后重试' },
      { status: 500 }
    );
  }
}
