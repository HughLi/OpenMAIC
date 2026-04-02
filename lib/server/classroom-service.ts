import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import type { Slide } from '@/lib/types/slides';
import { getDatabase } from '@/server/database';

// Storage directories
// New structure: data/classrooms/{owner_id}/{stage_id}/
export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_MEDIA_DIR = path.join(process.cwd(), 'data', 'classrooms', 'media');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

/**
 * Get classroom storage path with user isolation
 * Structure: data/classrooms/{owner_id}/{stage_id}/
 */
export function getClassroomPath(
  ownerId: string,
  stageId: string,
  subPath?: 'media' | 'scenes'
): string {
  const basePath = path.join(CLASSROOMS_DIR, ownerId, stageId);
  if (subPath === 'media') {
    return path.join(basePath, 'media');
  }
  if (subPath === 'scenes') {
    return path.join(basePath, 'scenes.json');
  }
  return path.join(basePath, 'stage.json');
}

// Ensure directories exist
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomMediaDir() {
  await ensureDir(CLASSROOM_MEDIA_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

// Atomic file write
export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

// Build request origin
export function buildRequestOrigin(req: NextRequest): string {
  return req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;
}

// Data interfaces
export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
  ownerId?: string;
}

export interface ClassroomMetadata {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  category: string;
  coverImage: string | null;
  visibility: 'private' | 'public' | 'shared';
  status: 'active' | 'archived' | 'deleted';
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  storagePath?: string | null;
  syncStatus?: 'local' | 'syncing' | 'synced' | 'error';
}

export interface MediaFile {
  id: string;
  classroomId: string;
  type: 'audio' | 'image' | 'video';
  filename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Validation
export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// Read classroom data from file system
// Supports both new user-isolated paths and legacy paths for backward compatibility
export async function readClassroom(
  id: string,
  ownerId?: string
): Promise<PersistedClassroomData | null> {
  // Try new user-isolated path first if ownerId provided
  if (ownerId) {
    const filePath = getClassroomPath(ownerId, id);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as PersistedClassroomData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // Fall through to try legacy path
    }
  }

  // Try legacy path (for backward compatibility)
  const legacyPath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(legacyPath, 'utf-8');
    return JSON.parse(content) as PersistedClassroomData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Get first slide from classroom (for thumbnail)
export async function getClassroomFirstSlide(id: string): Promise<Slide | null> {
  try {
    const classroom = await readClassroom(id);
    if (!classroom || !classroom.scenes || classroom.scenes.length === 0) {
      return null;
    }

    // Find first slide scene
    const firstSlideScene = classroom.scenes.find(
      (scene): scene is Scene & { content: { type: 'slide'; canvas: Slide } } =>
        scene.type === 'slide' && scene.content?.type === 'slide'
    );

    if (!firstSlideScene) {
      return null;
    }

    return firstSlideScene.content.canvas;
  } catch (error) {
    // Silently return null on error
    return null;
  }
}

// Persist classroom data to file system
// Uses user-isolated paths when ownerId is provided
export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    ownerId?: string;
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string; storagePath: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
    ownerId: data.ownerId,
  };

  // Use user-isolated path if ownerId is provided, otherwise fall back to legacy path
  const filePath = data.ownerId
    ? getClassroomPath(data.ownerId, data.id)
    : path.join(CLASSROOMS_DIR, `${data.id}.json`);

  await writeJsonFileAtomic(filePath, classroomData);

  // Calculate relative storage path for database
  const storagePath = data.ownerId
    ? path.join('classrooms', data.ownerId, data.id, 'stage.json')
    : path.join('classrooms', `${data.id}.json`);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
    storagePath,
  };
}

// Save media file (audio, image, video)
export async function saveMediaFile(
  classroomId: string,
  fileId: string,
  data: Buffer,
  options: {
    type: 'audio' | 'image' | 'video';
    mimeType: string;
    duration?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<MediaFile> {
  await ensureClassroomMediaDir();

  const ext = getExtensionFromMimeType(options.mimeType);
  const filename = `${fileId}.${ext}`;
  const filePath = path.join(CLASSROOM_MEDIA_DIR, classroomId);
  await ensureDir(filePath);

  const fullPath = path.join(filePath, filename);
  await fs.writeFile(fullPath, data);

  const fileSize = data.length;

  // Save to database
  const db = getDatabase();
  const relativePath = path.join('media', classroomId, filename);

  db.prepare(`
    INSERT INTO classroom_media (id, classroom_id, type, filename, file_path, file_size, mime_type, duration, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      file_size = excluded.file_size,
      file_path = excluded.file_path
  `).run(
    fileId,
    classroomId,
    options.type,
    filename,
    relativePath,
    fileSize,
    options.mimeType,
    options.duration || null,
    options.metadata ? JSON.stringify(options.metadata) : null
  );

  return {
    id: fileId,
    classroomId,
    type: options.type,
    filename,
    filePath: relativePath,
    fileSize,
    mimeType: options.mimeType,
    duration: options.duration,
    metadata: options.metadata,
    createdAt: new Date().toISOString(),
  };
}

// Read media file
export async function readMediaFile(classroomId: string, fileId: string): Promise<Buffer | null> {
  const db = getDatabase();
  const media = db.prepare(
    'SELECT file_path FROM classroom_media WHERE id = ? AND classroom_id = ?'
  ).get(fileId, classroomId) as { file_path: string } | undefined;

  if (!media) {
    return null;
  }

  const fullPath = path.join(CLASSROOMS_DIR, media.file_path);
  try {
    return await fs.readFile(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Get media file info
export function getMediaFileInfo(fileId: string): MediaFile | null {
  const db = getDatabase();
  const media = db.prepare(`
    SELECT id, classroom_id, type, filename, file_path, file_size, mime_type, duration, metadata, created_at
    FROM classroom_media WHERE id = ?
  `).get(fileId) as {
    id: string;
    classroom_id: string;
    type: 'audio' | 'image' | 'video';
    filename: string;
    file_path: string;
    file_size: number;
    mime_type: string;
    duration: number | null;
    metadata: string | null;
    created_at: string;
  } | undefined;

  if (!media) {
    return null;
  }

  return {
    id: media.id,
    classroomId: media.classroom_id,
    type: media.type,
    filename: media.filename,
    filePath: media.file_path,
    fileSize: media.file_size,
    mimeType: media.mime_type,
    duration: media.duration || undefined,
    metadata: media.metadata ? JSON.parse(media.metadata) : undefined,
    createdAt: media.created_at,
  };
}

// Save classroom metadata to database
export function saveClassroomMetadata(metadata: {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  category?: string;
  coverImage?: string;
  visibility?: 'private' | 'public' | 'shared';
  sceneCount: number;
  expiresAt?: string;
  storagePath?: string;
  syncStatus?: 'local' | 'syncing' | 'synced' | 'error';
}): void {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO classrooms (id, owner_id, title, description, category, cover_image, visibility, status, scene_count, expires_at, storage_path, sync_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      category = excluded.category,
      cover_image = excluded.cover_image,
      visibility = excluded.visibility,
      status = excluded.status,
      scene_count = excluded.scene_count,
      updated_at = datetime('now'),
      expires_at = excluded.expires_at,
      storage_path = COALESCE(excluded.storage_path, storage_path),
      sync_status = COALESCE(excluded.sync_status, sync_status)
  `).run(
    metadata.id,
    metadata.ownerId,
    metadata.title,
    metadata.description || null,
    metadata.category || 'other',
    metadata.coverImage || null,
    metadata.visibility || 'private',
    'active',
    metadata.sceneCount,
    metadata.expiresAt || null,
    metadata.storagePath || null,
    metadata.syncStatus || 'local'
  );
}

// Get classroom metadata from database
export function getClassroomMetadata(id: string): ClassroomMetadata | null {
  const db = getDatabase();
  const classroom = db.prepare(`
    SELECT id, owner_id, title, description, category, cover_image, visibility, status, scene_count, created_at, updated_at, expires_at, storage_path, sync_status
    FROM classrooms WHERE id = ?
  `).get(id) as {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    category: string;
    cover_image: string | null;
    visibility: 'private' | 'public' | 'shared';
    status: 'active' | 'archived' | 'deleted';
    scene_count: number;
    created_at: string;
    updated_at: string;
    expires_at: string | null;
    storage_path: string | null;
    sync_status: 'local' | 'syncing' | 'synced' | 'error';
  } | undefined;

  if (!classroom) {
    return null;
  }

  return {
    id: classroom.id,
    ownerId: classroom.owner_id,
    title: classroom.title,
    description: classroom.description,
    category: classroom.category,
    coverImage: classroom.cover_image,
    visibility: classroom.visibility,
    status: classroom.status,
    sceneCount: classroom.scene_count,
    createdAt: classroom.created_at,
    updatedAt: classroom.updated_at,
    expiresAt: classroom.expires_at,
    storagePath: classroom.storage_path,
    syncStatus: classroom.sync_status,
  };
}

// List user's classrooms
export function listUserClassrooms(userId: string): ClassroomMetadata[] {
  const db = getDatabase();
  const classrooms = db.prepare(`
    SELECT id, owner_id, title, description, category, cover_image, visibility, status, scene_count, created_at, updated_at, expires_at, storage_path, sync_status
    FROM classrooms WHERE owner_id = ? AND status = 'active'
    ORDER BY updated_at DESC
  `).all(userId) as Array<{
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    category: string;
    cover_image: string | null;
    visibility: 'private' | 'public' | 'shared';
    status: 'active' | 'archived' | 'deleted';
    scene_count: number;
    created_at: string;
    updated_at: string;
    expires_at: string | null;
    storage_path: string | null;
    sync_status: 'local' | 'syncing' | 'synced' | 'error';
  }>;

  return classrooms.map(c => ({
    id: c.id,
    ownerId: c.owner_id,
    title: c.title,
    description: c.description,
    category: c.category,
    coverImage: c.cover_image,
    visibility: c.visibility,
    status: c.status,
    sceneCount: c.scene_count,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    expiresAt: c.expires_at,
    storagePath: c.storage_path,
    syncStatus: c.sync_status,
  }));
}

// Check if user can access classroom
export function canAccessClassroom(classroomId: string, userId: string, userRole: string): boolean {
  const db = getDatabase();

  // Admin can access all
  if (userRole === 'admin') {
    return true;
  }

  // Check if user is owner
  const metadata = db.prepare('SELECT owner_id, visibility FROM classrooms WHERE id = ?').get(classroomId) as
    | { owner_id: string; visibility: string }
    | undefined;

  if (!metadata) {
    return false;
  }

  if (metadata.owner_id === userId) {
    return true;
  }

  // Check if public
  if (metadata.visibility === 'public') {
    return true;
  }

  // Check if user has been granted access
  const access = db.prepare(
    'SELECT id FROM classroom_access WHERE classroom_id = ? AND user_id = ?'
  ).get(classroomId, userId);

  return !!access;
}

// Delete classroom (soft delete)
export async function deleteClassroom(id: string): Promise<boolean> {
  const db = getDatabase();

  // Soft delete in database
  const result = db.prepare(
    "UPDATE classrooms SET status = 'deleted', updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  if (result.changes === 0) {
    return false;
  }

  // Rename file to mark as deleted (optional, can be cleaned up later)
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  const deletedPath = path.join(CLASSROOMS_DIR, `${id}.deleted.json`);

  try {
    await fs.rename(filePath, deletedPath);
  } catch {
    // Ignore errors, file might not exist
  }

  return true;
}

// Update classroom metadata
export function updateClassroom(
  id: string,
  ownerId: string,
  updates: {
    title?: string;
    description?: string;
    category?: string;
    coverImage?: string | null;
    visibility?: 'private' | 'public' | 'shared';
    status?: 'active' | 'archived' | 'deleted';
    sceneCount?: number;
    metadata?: string;
    storagePath?: string | null;
    syncStatus?: 'local' | 'syncing' | 'synced' | 'error';
  }
): boolean {
  const db = getDatabase();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.category !== undefined) {
    fields.push('category = ?');
    values.push(updates.category);
  }
  if (updates.coverImage !== undefined) {
    fields.push('cover_image = ?');
    values.push(updates.coverImage);
  }
  if (updates.visibility !== undefined) {
    fields.push('visibility = ?');
    values.push(updates.visibility);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.sceneCount !== undefined) {
    fields.push('scene_count = ?');
    values.push(updates.sceneCount);
  }
  if (updates.storagePath !== undefined) {
    fields.push('storage_path = ?');
    values.push(updates.storagePath);
  }
  if (updates.syncStatus !== undefined) {
    fields.push('sync_status = ?');
    values.push(updates.syncStatus);
  }

  fields.push("updated_at = datetime('now')");

  // Verify ownership
  const classroom = db.prepare('SELECT owner_id FROM classrooms WHERE id = ?').get(id) as
    | { owner_id: string }
    | undefined;

  if (!classroom || classroom.owner_id !== ownerId) {
    return false;
  }

  const sql = `UPDATE classrooms SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);

  const result = db.prepare(sql).run(...values);
  return result.changes > 0;
}

// Save scene (for migration)
export async function saveScene(
  classroomId: string,
  scene: Scene
): Promise<void> {
  const filePath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);

  let data: PersistedClassroomData;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    data = JSON.parse(content) as PersistedClassroomData;
  } catch {
    // Create new if doesn't exist
    data = {
      id: classroomId,
      stage: {} as Stage,
      scenes: [],
      createdAt: new Date().toISOString(),
    };
  }

  // Find existing scene index
  const sceneIndex = data.scenes.findIndex((s) => s.id === scene.id);
  if (sceneIndex >= 0) {
    data.scenes[sceneIndex] = scene;
  } else {
    data.scenes.push(scene);
  }

  // Sort by order
  data.scenes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  await writeJsonFileAtomic(filePath, data);
}

// Save media with Blob (for migration)
export async function saveMedia(
  classroomId: string,
  fileId: string,
  blob: Blob,
  options: {
    type: 'audio' | 'image' | 'video';
    filename: string;
    duration?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<MediaFile> {
  await ensureClassroomMediaDir();

  const buffer = Buffer.from(await blob.arrayBuffer());
  const mimeType = blob.type || 'application/octet-stream';

  return saveMediaFile(classroomId, fileId, buffer, {
    ...options,
    mimeType,
  });
}

// Create classroom (for migration)
export async function createClassroom(
  ownerId: string,
  data: {
    id: string;
    name: string;
    description?: string;
    language?: string;
    style?: string;
  }
): Promise<ClassroomMetadata> {
  const now = new Date().toISOString();

  const metadata: ClassroomMetadata = {
    id: data.id,
    ownerId,
    title: data.name,
    description: data.description || null,
    category: 'other',
    coverImage: null,
    visibility: 'private',
    status: 'active',
    sceneCount: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  };

  saveClassroomMetadata({
    id: data.id,
    ownerId,
    title: data.name,
    description: data.description,
    visibility: 'private',
    sceneCount: 0,
  });

  // Create initial classroom file
  const stage: Stage = {
    id: data.id,
    name: data.name,
    description: data.description,
    language: data.language,
    style: data.style,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await persistClassroom(
    {
      id: data.id,
      stage,
      scenes: [],
      ownerId,
    },
    ''
  );

  return metadata;
}

// Helper: get file extension from MIME type
function getExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return map[mimeType] || 'bin';
}

// Service object for convenient access
export const classroomService = {
  // Directories
  CLASSROOMS_DIR,
  CLASSROOM_MEDIA_DIR,
  CLASSROOM_JOBS_DIR,

  // Directory helpers
  ensureClassroomsDir,
  ensureClassroomMediaDir,
  ensureClassroomJobsDir,

  // Path helpers
  getClassroomPath,

  // CRUD operations
  createClassroom,
  readClassroom,
  persistClassroom,
  updateClassroom,
  deleteClassroom,

  // Metadata
  saveClassroomMetadata,
  getClassroomMetadata,
  listUserClassrooms,

  // Media
  saveMediaFile,
  saveMedia,
  readMediaFile,
  getMediaFileInfo,

  // Scenes
  saveScene,

  // Access control
  canAccessClassroom,

  // Validation
  isValidClassroomId,

  // Utilities
  writeJsonFileAtomic,
  buildRequestOrigin,
};
