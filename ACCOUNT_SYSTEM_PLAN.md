# OpenMAIC 账户系统与本地文件服务实现方案

## 更新后的架构设计

### 1. 账户角色模型

```
┌─────────────────────────────────────────────────────────────────┐
│                     角色权限体系                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │   Admin     │    │  Generator  │    │      Viewer         │ │
│  │  (管理员)    │    │  (生成者)   │    │     (观看者)         │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│        │                  │                     │               │
│        ▼                  ▼                     ▼               │
│   • 管理所有用户      • 创建/编辑课程       • 观看课程          │
│   • 分配角色          • 观看所有课程        • 申请临时生成权限  │
│   • 系统配置          • 管理自己的课程      • 管理自己的收藏    │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │              临时权限提升 (Temporary Elevated)           │  │
│   │                                                         │  │
│   │   Viewer 可申请临时 Generator 权限，经 Admin 或系统规则  │  │
│   │   自动批准后，在有效期内拥有生成权限                      │  │
│   │                                                         │  │
│   │   • 申请方式：点击"申请生成权限"按钮                      │  │
│   │   • 审批方式：Admin 手动审批 / 自动审批（如观看满10小时）│  │
│   │   • 有效期：24小时 / 7天 / 永久                         │  │
│   │   • 配额限制：临时用户每天最多生成3个课程                 │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 本地文件服务架构

```
OpenMAIC/
├── app/
│   └── api/
│       ├── auth/                    # 认证相关 API
│       │   ├── login/route.ts       # 登录
│       │   ├── register/route.ts    # 注册
│       │   ├── refresh/route.ts     # 刷新 Token
│       │   └── logout/route.ts      # 登出
│       ├── users/                   # 用户管理 API
│       │   ├── route.ts             # 用户 CRUD
│       │   └── [id]/
│       │       └── role/route.ts    # 角色管理
│       ├── classrooms/              # 课程管理 API
│       │   ├── route.ts             # 课程列表（按权限过滤）
│       │   └── [id]/
│       │       ├── route.ts         # 课程详情
│       │       └── share/route.ts   # 分享管理
│       └── permissions/             # 权限申请 API
│           └── request/route.ts     # 申请临时权限
│
├── server/                          # 服务端基础设施
│   ├── database/                    # 数据库
│   │   ├── schema.sql               # 数据库 Schema
│   │   └── sqlite.ts                # SQLite 连接
│   ├── storage/                     # 文件存储
│   │   ├── local-fs.ts              # 本地文件系统存储
│   │   └── classrooms/              # 课程数据存储
│   ├── auth/                        # 认证模块
│   │   ├── jwt.ts                   # JWT 工具
│   │   ├── password.ts              # 密码加密
│   │   └── middleware.ts            # 认证中间件
│   └── permissions/                 # 权限系统
│       ├── roles.ts                 # 角色定义
│       └── checks.ts                # 权限检查
│
└── data/                            # 本地数据目录（gitignored）
    ├── database/
    │   └── openmaic.db              # SQLite 数据库
    └── classrooms/                  # 课程文件存储
        ├── {classroom-id}.json
        └── media/
            ├── {classroom-id}/
            │   ├── audio/
            │   ├── images/
            │   └── videos/
```

---

## 数据库 Schema

### 用户表 (users)

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,                    -- UUID
    username TEXT UNIQUE NOT NULL,          -- 登录名
    email TEXT UNIQUE,                      -- 邮箱
    password_hash TEXT NOT NULL,            -- bcrypt 哈希
    role TEXT NOT NULL DEFAULT 'viewer',    -- admin/generator/viewer
    role_expires_at TIMESTAMP,              -- 角色过期时间（临时权限）

    -- 临时权限相关
    temporary_generator_until TIMESTAMP,    -- 临时生成权限到期时间
    daily_generation_quota INTEGER DEFAULT 0, -- 每日生成配额
    daily_generation_used INTEGER DEFAULT 0,  -- 今日已用配额

    -- 用户配置
    display_name TEXT,                      -- 显示名称
    avatar_url TEXT,                        -- 头像
    preferences TEXT,                       -- JSON 配置

    -- 统计信息
    total_view_time_seconds INTEGER DEFAULT 0, -- 累计观看时长
    classrooms_created INTEGER DEFAULT 0,      -- 创建课程数

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
);

-- 索引
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_username ON users(username);
```

### 课程表 (classrooms)

```sql
CREATE TABLE classrooms (
    id TEXT PRIMARY KEY,                    -- UUID
    owner_id TEXT NOT NULL,                 -- 创建者ID

    -- 课程信息（与 JSON 文件冗余存储，便于查询）
    name TEXT NOT NULL,                     -- 课程名
    description TEXT,                       -- 描述
    language TEXT,                          -- 语言
    scene_count INTEGER DEFAULT 0,          -- 场景数量

    -- 访问控制
    visibility TEXT DEFAULT 'private',      -- public/private/shared

    -- 统计
    view_count INTEGER DEFAULT 0,           -- 观看次数

    -- 存储路径
    data_file_path TEXT NOT NULL,           -- JSON 文件路径

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_classrooms_owner ON classrooms(owner_id);
CREATE INDEX idx_classrooms_visibility ON classrooms(visibility);
```

### 课程访问权限表 (classroom_permissions)

```sql
-- 用于共享课程给特定用户
CREATE TABLE classroom_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classroom_id TEXT NOT NULL,
    user_id TEXT NOT NULL,                  -- 被授权用户
    permission TEXT NOT NULL DEFAULT 'view', -- view/edit/admin
    granted_by TEXT NOT NULL,               -- 授权人
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,                   -- 权限过期时间

    UNIQUE(classroom_id, user_id),
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id)
);

CREATE INDEX idx_perm_classroom ON classroom_permissions(classroom_id);
CREATE INDEX idx_perm_user ON classroom_permissions(user_id);
```

### 权限申请表 (permission_requests)

```sql
CREATE TABLE permission_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,                  -- 申请人
    request_type TEXT NOT NULL,             -- generator_upgrade
    reason TEXT,                            -- 申请理由

    -- 审批状态
    status TEXT DEFAULT 'pending',          -- pending/approved/rejected
    reviewed_by TEXT,                       -- 审批人
    reviewed_at TIMESTAMP,                  -- 审批时间
    review_note TEXT,                       -- 审批备注

    -- 如果批准，有效期
    granted_duration_hours INTEGER,         -- 授权时长

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE INDEX idx_perm_req_user ON permission_requests(user_id);
CREATE INDEX idx_perm_req_status ON permission_requests(status);
```

### 观看记录表 (viewing_sessions)

```sql
CREATE TABLE viewing_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    classroom_id TEXT NOT NULL,

    -- 观看信息
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    duration_seconds INTEGER,               -- 观看时长
    progress_percent INTEGER,               -- 观看进度
    completed BOOLEAN DEFAULT FALSE,        -- 是否看完

    -- 设备信息
    ip_address TEXT,
    user_agent TEXT,

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
);

CREATE INDEX idx_view_user ON viewing_sessions(user_id);
CREATE INDEX idx_view_classroom ON viewing_sessions(classroom_id);
```

---

## API 设计

### 认证相关

#### POST /api/auth/login
```typescript
// Request
{
  "username": string;
  "password": string;
}

// Response
{
  "success": true;
  "data": {
    "user": {
      "id": string;
      "username": string;
      "displayName": string;
      "role": "viewer" | "generator" | "admin";
      "temporaryGeneratorUntil"?: string;
    },
    "tokens": {
      "accessToken": string;   // JWT, 15分钟过期
      "refreshToken": string;  // 7天过期
    }
  }
}
```

#### POST /api/auth/register
```typescript
// Request
{
  "username": string;
  "password": string;
  "email"?: string;
  "displayName"?: string;
}

// 默认角色：viewer
```

#### POST /api/auth/refresh
```typescript
// Request
{
  "refreshToken": string;
}

// Response - 新的 accessToken
```

### 用户管理（Admin 权限）

#### GET /api/users
列出所有用户（分页）

#### PATCH /api/users/:id/role
```typescript
// Request
{
  "role": "generator" | "viewer" | "admin";
  "temporaryUntil"?: string;  // ISO8601, 可选
  "dailyQuota"?: number;      // 每日生成配额
}
```

### 课程管理

#### GET /api/classrooms
获取课程列表（根据用户角色过滤）

```typescript
// Viewer: 只能看到 public 的或自己有权限的
// Generator: 自己的 + public 的 + 有权限的
// Admin: 所有

// Query params
{
  "page"?: number;
  "limit"?: number;
  "search"?: string;
  "owner"?: string;  // 按创建者筛选
}

// Response
{
  "success": true;
  "data": {
    "items": Classroom[];
    "total": number;
    "page": number;
  }
}
```

#### POST /api/classrooms
创建课程（需要 generator 或 admin 权限，或临时权限）

```typescript
// 权限检查逻辑：
// 1. 检查用户角色是否为 generator 或 admin
// 2. 或检查 temporary_generator_until > now()
// 3. 检查 daily_generation_used < daily_generation_quota
```

#### GET /api/classrooms/:id
获取课程详情

```typescript
// 权限检查：
// 1. owner 可以直接访问
// 2. visibility=public 可以访问
// 3. 在 classroom_permissions 表中有记录可以访问
// 4. Admin 可以访问
```

### 权限申请

#### POST /api/permissions/request
申请临时生成权限

```typescript
// Request
{
  "reason": string;  // 申请理由
}

// 自动审批规则（可配置）：
// - 观看时长累计超过 10 小时
// - 或 Admin 手动审批
```

#### GET /api/permissions/request
查看申请状态（用户自己）

#### PATCH /api/permissions/request/:id
审批申请（Admin 权限）

```typescript
// Request
{
  "status": "approved" | "rejected";
  "durationHours": number;  // 24, 168(7天), 0(永久)
  "dailyQuota": number;     // 每日生成配额
  "note"?: string;
}
```

---

## 本地文件服务实现

### 目录结构

```
data/
├── database/
│   └── openmaic.db              # SQLite 数据库
├── classrooms/
│   ├── cm_abc123.json           # 课程数据文件
│   ├── cm_def456.json
│   └── media/
│       ├── cm_abc123/
│       │   ├── audio/
│       │   │   └── audio_xxx.mp3
│       │   ├── images/
│       │   │   └── image_yyy.png
│       │   └── videos/
│       │       └── video_zzz.mp4
│       └── cm_def456/
└── temp/                        # 临时文件
```

### 存储实现 (server/storage/local-fs.ts)

```typescript
import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CLASSROOMS_DIR = path.join(DATA_DIR, 'classrooms');
const MEDIA_DIR = path.join(CLASSROOMS_DIR, 'media');

export class LocalFileStorage {
  // 确保目录存在
  async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  // 保存课程数据
  async saveClassroom(classroomId: string, data: object): Promise<string> {
    const filePath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);
    await this.ensureDir(CLASSROOMS_DIR);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return filePath;
  }

  // 读取课程数据
  async readClassroom(classroomId: string): Promise<object | null> {
    const filePath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  // 删除课程数据
  async deleteClassroom(classroomId: string): Promise<void> {
    const filePath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);
    const mediaDir = path.join(MEDIA_DIR, classroomId);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // 删除媒体文件
    try {
      await fs.rm(mediaDir, { recursive: true, force: true });
    } catch {
      // 忽略不存在错误
    }
  }

  // 保存媒体文件
  async saveMedia(
    classroomId: string,
    mediaId: string,
    blob: Buffer,
    type: 'audio' | 'image' | 'video'
  ): Promise<string> {
    const dir = path.join(MEDIA_DIR, classroomId, type + 's');
    await this.ensureDir(dir);

    const ext = type === 'audio' ? 'mp3' : type === 'image' ? 'png' : 'mp4';
    const filePath = path.join(dir, `${mediaId}.${ext}`);
    await fs.writeFile(filePath, blob);

    return filePath;
  }

  // 读取媒体文件
  async readMedia(
    classroomId: string,
    mediaId: string,
    type: 'audio' | 'image' | 'video'
  ): Promise<Buffer | null> {
    const ext = type === 'audio' ? 'mp3' : type === 'image' ? 'png' : 'mp4';
    const filePath = path.join(MEDIA_DIR, classroomId, type + 's', `${mediaId}.${ext}`);

    try {
      return await fs.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  // 列出所有课程
  async listClassrooms(): Promise<string[]> {
    await this.ensureDir(CLASSROOMS_DIR);
    const files = await fs.readdir(CLASSROOMS_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}

export const storage = new LocalFileStorage();
```

---

## 认证中间件实现

### JWT 工具 (server/auth/jwt.ts)

```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  type: 'access' | 'refresh';
}

export function generateTokens(payload: Omit<JWTPayload, 'type'>): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = jwt.sign(
    { ...payload, type: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  return { accessToken, refreshToken };
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}
```

### 认证中间件 (server/auth/middleware.ts)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './jwt';
import { getUserById } from '../database/user';

export interface AuthenticatedRequest extends NextRequest {
  user: {
    id: string;
    username: string;
    role: string;
    isTemporaryGenerator: boolean;
    dailyQuota: number;
    dailyUsed: number;
  };
}

export async function authMiddleware(
  request: NextRequest
): Promise<{ success: true; user: AuthenticatedRequest['user'] } | { success: false; response: NextResponse }> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return {
      success: false,
      response: NextResponse.json(
        { success: false, error: 'Missing authentication token' },
        { status: 401 }
      )
    };
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyToken(token);

    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }

    // 获取用户最新信息（检查临时权限是否过期）
    const user = await getUserById(payload.userId);

    if (!user) {
      throw new Error('User not found');
    }

    // 检查临时权限
    const isTemporaryGenerator = user.temporary_generator_until
      ? new Date(user.temporary_generator_until) > new Date()
      : false;

    // 如果临时权限过期，重置相关字段
    if (user.temporary_generator_until && !isTemporaryGenerator) {
      await resetTemporaryPermissions(user.id);
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        isTemporaryGenerator,
        dailyQuota: user.daily_generation_quota,
        dailyUsed: user.daily_generation_used
      }
    };
  } catch (error) {
    return {
      success: false,
      response: NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      )
    };
  }
}

// 权限检查辅助函数
export function requireRole(
  user: AuthenticatedRequest['user'],
  allowedRoles: string[]
): boolean {
  // Admin 拥有所有权限
  if (user.role === 'admin') return true;

  // 检查基本角色
  if (allowedRoles.includes(user.role)) return true;

  // 检查临时生成权限
  if (allowedRoles.includes('generator') && user.isTemporaryGenerator) {
    // 检查配额
    if (user.dailyUsed < user.dailyQuota) {
      return true;
    }
  }

  return false;
}

// 检查是否可以生成课程
export function canGenerate(user: AuthenticatedRequest['user']): {
  allowed: boolean;
  reason?: string;
} {
  if (user.role === 'admin' || user.role === 'generator') {
    return { allowed: true };
  }

  if (user.isTemporaryGenerator) {
    if (user.dailyUsed >= user.dailyQuota) {
      return {
        allowed: false,
        reason: `Daily quota exceeded (${user.dailyUsed}/${user.dailyQuota})`
      };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Insufficient permissions' };
}
```

---

## 前端集成

### 认证上下文 (lib/auth/AuthContext.tsx)

```typescript
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'viewer' | 'generator' | 'admin';
  temporaryGeneratorUntil?: string;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  canGenerate: boolean;
  requestGeneratorPermission: (reason: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 检查本地存储的 token
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      fetchUserInfo(token);
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchUserInfo = async (token: string) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      throw new Error('Login failed');
    }

    const data = await res.json();
    localStorage.setItem('accessToken', data.data.tokens.accessToken);
    localStorage.setItem('refreshToken', data.data.tokens.refreshToken);
    setUser(data.data.user);
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  const canGenerate = user?.role === 'admin' ||
                      user?.role === 'generator' ||
                      (user?.temporaryGeneratorUntil ? new Date(user.temporaryGeneratorUntil) > new Date() : false);

  const requestGeneratorPermission = async (reason: string) => {
    const token = localStorage.getItem('accessToken');
    const res = await fetch('/api/permissions/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ reason })
    });

    if (!res.ok) {
      throw new Error('Request failed');
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      isLoading,
      canGenerate,
      requestGeneratorPermission
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
```

### 权限申请 UI (components/permissions/RequestGeneratorDialog.tsx)

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';

export function RequestGeneratorButton() {
  const { user, canGenerate, requestGeneratorPermission } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 如果已有权限，不显示按钮
  if (canGenerate) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await requestGeneratorPermission(reason);
      setIsOpen(false);
      alert('申请已提交，请等待管理员审批');
    } catch (error) {
      alert('申请失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
      >
        申请生成权限
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[400px]">
            <h2 className="text-xl font-bold mb-4">申请课程生成权限</h2>
            <p className="text-sm text-gray-600 mb-4">
              请说明您需要生成权限的原因，管理员将审核您的申请。
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：我需要为公司培训生成课程内容..."
              className="w-full h-24 p-2 border rounded mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!reason.trim() || isSubmitting}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {isSubmitting ? '提交中...' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

---

## 实施步骤

### 第一阶段：本地文件服务基础（2-3 天）

1. **数据库搭建**
   - [ ] 安装 better-sqlite3 依赖
   - [ ] 创建 database/schema.sql
   - [ ] 实现数据库连接和初始化
   - [ ] 创建用户数据访问层

2. **文件存储实现**
   - [ ] 实现 LocalFileStorage 类
   - [ ] 添加文件操作 API
   - [ ] 测试文件读写

3. **认证系统**
   - [ ] 实现 JWT 工具
   - [ ] 实现密码加密
   - [ ] 创建登录/注册 API
   - [ ] 实现认证中间件

### 第二阶段：账户系统完整实现（3-4 天）

1. **用户管理**
   - [ ] 用户 CRUD API
   - [ ] 角色管理
   - [ ] 临时权限系统

2. **课程权限**
   - [ ] 课程访问控制
   - [ ] 共享功能
   - [ ] 观看记录

3. **权限申请**
   - [ ] 申请提交 API
   - [ ] 审批流程
   - [ ] 自动审批规则

### 第三阶段：前端集成（2-3 天）

1. **认证上下文**
   - [ ] AuthProvider 实现
   - [ ] 登录/注册页面
   - [ ] 权限检查 hook

2. **UI 改造**
   - [ ] 根据角色显示不同功能
   - [ ] 权限申请按钮
   - [ ] 管理员后台

3. **课程管理**
   - [ ] 课程列表权限过滤
   - [ ] 播放权限检查
   - [ ] 生成权限检查

### 第四阶段：视频导出（后续迭代）

在完成账户系统后，再实现视频导出功能。

---

## 开发命令

```bash
# 安装依赖
pnpm add better-sqlite3 jsonwebtoken bcryptjs
pnpm add -D @types/better-sqlite3 @types/jsonwebtoken @types/bcryptjs

# 创建数据目录
mkdir -p data/database data/classrooms/media

# 初始化数据库（创建脚本）
node scripts/init-db.js

# 创建默认管理员账号
node scripts/create-admin.js --username=admin --password=admin123
```

---

## 配置环境变量

```bash
# .env.local

# JWT 配置
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# 数据库
DATABASE_PATH=./data/database/openmaic.db

# 存储
STORAGE_TYPE=local
STORAGE_BASE_PATH=./data/classrooms

# 临时权限自动审批规则
AUTO_APPROVE_AFTER_VIEW_HOURS=10
DEFAULT_TEMP_QUOTA=3
```

---

这个方案符合你的需求吗？需要我调整哪些部分？