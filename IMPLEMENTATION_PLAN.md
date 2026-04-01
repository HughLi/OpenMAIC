# OpenMAIC 增强功能实现方案

## 需求概述

1. **多设备访问 + 账户隔离**：本地部署后，生成的课程可在平板等设备观看，但生成者和观看者使用不同账号
2. **视频导出**：将 PPT + TTS 音频合成视频，自动播放，跳过测验和互动环节

---

## 功能一：多设备访问与账户隔离

### 方案设计

#### 1.1 架构调整

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenMAIC Server                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Generator   │  │   Viewer     │  │   Classroom Data     │  │
│  │   (生成者)    │  │   (观看者)    │  │      (隔离存储)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                 │                    │               │
│         ▼                 ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                   数据模型变更                           │  │
│  │  - Classroom 增加 ownerId (创建者ID)                     │  │
│  │  - Classroom 增加 accessCode (观看验证码)                │  │
│  │  - Classroom 增加 visibility (public/private)           │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### 1.2 数据模型变更

**Classroom 扩展字段**（`lib/server/classroom-storage.ts`）：

```typescript
interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;

  // === 新增字段 ===
  ownerId?: string;           // 创建者标识（生成者）
  accessCode?: string;        // 6位观看验证码
  visibility: 'private' | 'public';  // 访问权限
  allowedViewers?: string[];  // 允许观看的设备/用户ID列表
  viewCount?: number;         // 观看次数统计
  lastViewedAt?: string;      // 最后观看时间
}
```

#### 1.3 API 设计

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/classroom` | POST | 创建课程 | Generator Key |
| `/api/classroom?id=xxx` | GET | 获取课程详情 | Access Code (Header) |
| `/api/classroom/access` | POST | 验证观看码 | Access Code |
| `/api/classrooms` | GET | 列出用户的课程 | Generator Key |
| `/api/classroom/share` | POST | 生成/刷新观看码 | Generator Key |

**访问控制逻辑**：
- 生成者访问：需要 `X-Generator-Key` Header
- 观看者访问：需要 `X-Access-Code` Header（6位数字/字母）
- 公开课程：无需认证，直接访问

#### 1.4 观看模式页面

新增 `/viewer/[id]/page.tsx`：
- 简化 UI，隐藏编辑、生成相关功能
- 仅保留播放控制、幻灯片导航、字幕显示
- 自适应平板触摸操作
- 支持离线缓存（Service Worker）

### 实现步骤

1. **后端改造**（预计 2-3 天）
   - [ ] 扩展 `PersistedClassroomData` 类型
   - [ ] 添加访问控制中间件
   - [ ] 实现 `/api/classroom/access` 验证端点
   - [ ] 修改现有 API 添加认证检查

2. **观看端开发**（预计 3-4 天）
   - [ ] 创建 `/viewer/[id]` 路由
   - [ ] 实现简化版播放器 UI
   - [ ] 添加观看码输入界面
   - [ ] 实现触摸手势支持（滑动翻页）

3. **生成端改造**（预计 1-2 天）
   - [ ] 在课程生成后显示观看码
   - [ ] 添加"分享"功能生成二维码
   - [ ] 管理已创建的课程列表

---

## 功能二：PPT + TTS 视频导出

### 方案设计

#### 2.1 技术选型

使用 **浏览器端视频合成**（无需服务器 ffmpeg）：
- `MediaRecorder` API 录制 Canvas
- `AudioContext` 处理音频时序
- 离屏渲染幻灯片到 Canvas

```
┌─────────────────────────────────────────────────────────────┐
│                    视频导出流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 初始化                                                   │
│     ├── 创建离屏 Canvas (1920x1080)                         │
│     ├── 初始化 MediaRecorder (video/webm)                   │
│     └── 加载所有资源（幻灯片图片、音频 Blob）                 │
│                                                             │
│  2. 逐页渲染                                                 │
│     ├── 渲染幻灯片到 Canvas                                 │
│     ├── 同步播放对应音频                                     │
│     ├── 计算音频时长 → 录制对应帧数                         │
│     └── 跳转到下一页                                         │
│                                                             │
│  3. 仅处理 Slide 类型场景                                    │
│     ├── 跳过 Quiz 场景                                       │
│     ├── 跳过 Interactive 场景                                │
│     ├── 跳过 PBL 场景                                        │
│     └── 仅保留 SpeechAction 的音频                          │
│                                                             │
│  4. 输出                                                     │
│     ├── 生成 WebM 视频                                       │
│     ├── 可选：使用 ffmpeg.wasm 转 MP4                       │
│     └── 下载文件                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.2 核心实现

**视频导出 Hook**（`lib/export/use-export-video.ts`）：

```typescript
interface VideoExportOptions {
  width?: number;        // 默认 1920
  height?: number;       // 默认 1080
  fps?: number;          // 默认 30
  format?: 'webm' | 'mp4';
  quality?: number;      // 0-1, 默认 0.95
  includeWhiteboard?: boolean;  // 是否包含白板动画
}

interface VideoExportProgress {
  status: 'preparing' | 'rendering' | 'encoding' | 'done' | 'error';
  currentSlide: number;
  totalSlides: number;
  progress: number;  // 0-100
  estimatedTimeRemaining?: number;
}

export function useExportVideo() {
  const exportVideo = async (
    scenes: Scene[],
    audioFiles: AudioFileRecord[],
    options?: VideoExportOptions,
    onProgress?: (progress: VideoExportProgress) => void
  ): Promise<Blob>;

  return { exportVideo, abort: () => void };
}
```

**幻灯片渲染器**（`lib/export/video-slide-renderer.ts`）：
- 复用现有 `slide-renderer` 组件逻辑
- 适配 Canvas 2D API 渲染
- 支持文字、图片、形状、图表、LaTeX 渲染

**音频时序控制**（`lib/export/video-audio-mixer.ts`）：
- 使用 Web Audio API 精确控制播放
- 每页音频与视频帧同步
- 支持音频淡入淡出

#### 2.3 UI 集成

在 `components/header.tsx` 导出菜单添加：

```typescript
const exportOptions = [
  { id: 'pptx', label: t('export.pptx'), icon: FileDown },
  { id: 'resource', label: t('export.resourcePack'), icon: Package },
  { id: 'video', label: t('export.video'), icon: Video },  // 新增
];
```

**视频导出对话框**：
- 分辨率选择（720p/1080p/4K）
- 帧率选择（24/30/60 fps）
- 是否包含白板动画
- 预估文件大小和时长
- 进度条显示

### 实现步骤

1. **基础渲染器**（预计 3-4 天）
   - [ ] 创建 `VideoSlideRenderer` 类
   - [ ] 实现 Slide 到 Canvas 的渲染
   - [ ] 处理各种元素类型（文本、图片、形状、图表、公式）

2. **视频合成引擎**（预计 4-5 天）
   - [ ] 实现 `useExportVideo` hook
   - [ ] 集成 MediaRecorder API
   - [ ] 实现音频时序同步
   - [ ] 添加进度回调

3. **UI 与优化**（预计 2-3 天）
   - [ ] 添加导出选项对话框
   - [ ] 实现视频格式转码（可选 ffmpeg.wasm）
   - [ ] 添加取消/暂停功能
   - [ ] 性能优化（Web Worker、离屏渲染）

---

## 数据库变更

### 服务端存储（classroom-storage.ts）

```typescript
// 新增：观看者访问记录
interface ViewerAccessRecord {
  classroomId: string;
  viewerId: string;      // 设备指纹或用户ID
  accessedAt: string;
  ip?: string;
  userAgent?: string;
}

// 扩展 PersistedClassroomData
interface PersistedClassroomData {
  // ... 原有字段 ...

  // 账户隔离
  ownerId: string;                    // 创建者ID
  accessCode: string;                 // 6位观看码
  visibility: 'private' | 'public';
  maxViewers?: number;                // 最大观看人数限制

  // 统计信息
  viewCount: number;
  lastViewedAt?: string;
  createdAt: string;
  expiresAt?: string;                 // 课程过期时间
}
```

### IndexedDB 变更（database.ts）

无需变更，观看端仍使用相同的 IndexedDB 结构，但：
- 观看端只读，不写入
- 观看码验证通过后缓存到 localStorage

---

## API 详细设计

### POST /api/classroom/access

验证观看码并获取临时访问令牌。

**请求**：
```json
{
  "classroomId": "abc123",
  "accessCode": "123456"
}
```

**响应**：
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 3600,
  "classroom": {
    "id": "abc123",
    "name": "Quantum Physics 101",
    "sceneCount": 12
  }
}
```

### GET /api/classroom?id=xxx

获取课程详情（需认证）。

**Headers**：
```
Authorization: Bearer <token>  // 观看者
X-Generator-Key: <key>        // 或生成者
```

**响应**：与现有格式相同

### POST /api/classroom/share

生成/刷新观看码。

**Headers**：
```
X-Generator-Key: <key>
```

**请求**：
```json
{
  "classroomId": "abc123",
  "action": "generate"  // 或 "revoke" 撤销
}
```

**响应**：
```json
{
  "success": true,
  "accessCode": "123456",
  "qrCode": "data:image/png;base64,..."
}
```

---

## 项目结构变更

```
app/
├── api/
│   ├── classroom/
│   │   └── route.ts           # 修改：添加认证
│   ├── classroom-access/
│   │   └── route.ts           # 新增：观看码验证
│   └── classroom-share/
│       └── route.ts           # 新增：生成观看码
├── viewer/
│   └── [id]/
│       ├── page.tsx           # 新增：观看端主页面
│       └── layout.tsx         # 新增：观看端布局
├── classroom/
│   └── [id]/
│       └── page.tsx           # 修改：添加生成者认证

lib/
├── export/
│   ├── use-export-pptx.ts     # 现有
│   ├── use-export-video.ts    # 新增：视频导出 hook
│   ├── video-slide-renderer.ts # 新增：幻灯片渲染器
│   └── video-audio-mixer.ts   # 新增：音频混合器
├── server/
│   ├── classroom-storage.ts   # 修改：添加账户字段
│   └── access-control.ts      # 新增：访问控制逻辑
├── viewer/
│   ├── viewer-player.ts       # 新增：简化版播放器
│   └── touch-controls.ts      # 新增：触摸手势支持
└── hooks/
    └── use-access-code.ts     # 新增：观看码管理

components/
├── export/
│   └── video-export-dialog.tsx # 新增：视频导出对话框
└── viewer/
    ├── access-code-input.tsx   # 新增：观看码输入
    └── viewer-header.tsx       # 新增：观看端头部
```

---

## 开发时间估算

| 功能模块 | 预计时间 | 优先级 |
|----------|----------|--------|
| 账户隔离 - 后端 API | 3 天 | P0 |
| 账户隔离 - 观看端页面 | 4 天 | P0 |
| 账户隔离 - 生成端改造 | 2 天 | P0 |
| 视频导出 - 基础渲染器 | 4 天 | P1 |
| 视频导出 - 合成引擎 | 5 天 | P1 |
| 视频导出 - UI 集成 | 3 天 | P1 |
| 测试与优化 | 3 天 | - |
| **总计** | **24 天** | - |

---

## 技术风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| MediaRecorder 兼容性 | 高 | 提供降级方案（ffmpeg.wasm 转码） |
| 大视频文件内存溢出 | 高 | 分片录制 + StreamSaver.js 流式下载 |
| Canvas 渲染性能 | 中 | Web Worker 离屏渲染 + 低分辨率预览 |
| 音频同步精度 | 中 | Web Audio API timestamp 精确控制 |
| 平板兼容性 | 中 | 充分测试 iOS Safari 和 Android Chrome |

---

## 需要确认的问题

1. **观看码策略**：
   - 是否需要每次观看都输入验证码？
   - 还是一次验证后，设备可以记住一段时间？

2. **视频导出分辨率**：
   - 默认 1080p 是否足够？
   - 是否需要支持 4K？

3. **视频时长预估**：
   - 是否需要精确计算每页停留时间（根据音频时长）？
   - 还是固定每页 5 秒 + 音频时长？

4. **观看端权限**：
   - 观看者能否暂停、快进、后退？
   - 还是只能顺序观看？

5. **数据存储**：
   - 观看记录（谁看了、看了多久）是否需要保存？
   - 课程是否有有效期限制？

请确认这些问题，我将开始实现。