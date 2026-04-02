import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { saveClassroomMetadata, CLASSROOMS_DIR, getClassroomPath } from '@/lib/server/classroom-service';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { promises as fs } from 'fs';
import path from 'path';

// Auth middleware
async function requireAuth(request: NextRequest): Promise<AccessTokenPayload | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Missing authorization header');
  }

  const token = authHeader.substring(7);
  try {
    return await verifyToken(token) as AccessTokenPayload;
  } catch {
    return apiError(API_ERROR_CODES.TOKEN_INVALID, 401, 'Invalid token');
  }
}

interface ClassroomFileInfo {
  id: string;
  filePath: string;
  ownerId: string;
  storagePath: string;
}

// Scan legacy flat structure (data/classrooms/{id}.json)
async function scanLegacyClassrooms(): Promise<ClassroomFileInfo[]> {
  const results: ClassroomFileInfo[] = [];

  try {
    await fs.access(CLASSROOMS_DIR);
    const files = await fs.readdir(CLASSROOMS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('.deleted.'));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(CLASSROOMS_DIR, file);
        const id = path.basename(file, '.json');

        // Read to get ownerId
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        results.push({
          id,
          filePath,
          ownerId: data.ownerId || 'unknown',
          storagePath: path.join('classrooms', file),
        });
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}

// Scan new user-isolated structure (data/classrooms/{ownerId}/{stageId}/stage.json)
async function scanUserIsolatedClassrooms(): Promise<ClassroomFileInfo[]> {
  const results: ClassroomFileInfo[] = [];

  try {
    await fs.access(CLASSROOMS_DIR);
    const ownerDirs = await fs.readdir(CLASSROOMS_DIR, { withFileTypes: true });

    for (const ownerDir of ownerDirs.filter(d => d.isDirectory())) {
      const ownerId = ownerDir.name;
      const ownerPath = path.join(CLASSROOMS_DIR, ownerId);

      try {
        const stageDirs = await fs.readdir(ownerPath, { withFileTypes: true });

        for (const stageDir of stageDirs.filter(d => d.isDirectory())) {
          const stageId = stageDir.name;
          const stageFilePath = path.join(ownerPath, stageId, 'stage.json');

          try {
            await fs.access(stageFilePath);
            results.push({
              id: stageId,
              filePath: stageFilePath,
              ownerId,
              storagePath: path.join('classrooms', ownerId, stageId, 'stage.json'),
            });
          } catch {
            // stage.json doesn't exist in this directory
          }
        }
      } catch {
        // Error reading owner directory
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}

/**
 * POST /api/classroom/sync-files
 * Scan filesystem for classrooms and sync metadata to database
 * This is useful for migrating existing classrooms that only exist in filesystem
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const specificId = body.id; // Optional: sync specific classroom
    const { getDatabase } = await import('@/server/database');
    const db = getDatabase();

    const results = {
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [] as string[],
      ids: [] as string[],
    };

    // Check if classrooms directory exists
    try {
      await fs.access(CLASSROOMS_DIR);
    } catch {
      return apiSuccess({
        message: 'No classrooms directory found',
        ...results,
      });
    }

    // Scan both legacy and new structures
    const [legacyFiles, isolatedFiles] = await Promise.all([
      scanLegacyClassrooms(),
      scanUserIsolatedClassrooms(),
    ]);

    // Merge and deduplicate (prefer new structure)
    const fileMap = new Map<string, ClassroomFileInfo>();
    for (const file of legacyFiles) {
      fileMap.set(file.id, file);
    }
    for (const file of isolatedFiles) {
      fileMap.set(file.id, file); // New structure takes precedence
    }

    const allFiles = Array.from(fileMap.values());

    for (const fileInfo of allFiles) {
      try {
        const { id, filePath, ownerId, storagePath } = fileInfo;

        // Skip if specific ID requested and doesn't match
        if (specificId && id !== specificId) {
          continue;
        }

        results.scanned++;

        // Check if already exists in database with same storage path
        const existing = db.prepare('SELECT storage_path FROM classrooms WHERE id = ?').get(id) as { storage_path: string | null } | undefined;
        if (existing?.storage_path === storagePath) {
          results.skipped++;
          continue;
        }

        // Read classroom data
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        const stage = data.stage || {};
        const scenes = data.scenes || [];

        // Determine owner - prefer data ownerId, then from path, then current user
        const finalOwnerId = data.ownerId || ownerId || auth.userId;

        // Save metadata to database with storage path
        saveClassroomMetadata({
          id,
          ownerId: finalOwnerId,
          title: stage.name || stage.title || 'Untitled Course',
          description: stage.description,
          category: stage.category || 'other',
          visibility: stage.visibility || 'private',
          sceneCount: scenes.length,
          storagePath,
          syncStatus: 'local',
        });

        results.imported++;
        results.ids.push(id);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`Failed to import ${fileInfo.id}: ${errorMsg}`);
      }
    }

    return apiSuccess({
      message: `Scanned ${results.scanned} files, imported ${results.imported}, skipped ${results.skipped}`,
      ...results,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to sync classrooms',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * GET /api/classroom/sync-files
 * List classrooms that exist in filesystem but not in database
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { getDatabase } = await import('@/server/database');
    const db = getDatabase();

    // Scan both structures for classrooms in filesystem
    const [legacyFiles, isolatedFiles] = await Promise.all([
      scanLegacyClassrooms(),
      scanUserIsolatedClassrooms(),
    ]);

    const allFiles = [...legacyFiles, ...isolatedFiles];
    const fsIds = allFiles.map(f => f.id);
    const fsIdSet = new Set(fsIds);

    // Get list of classrooms in database
    const dbClassrooms = db.prepare('SELECT id, title, storage_path, sync_status FROM classrooms').all() as Array<{ id: string; title: string; storage_path: string | null; sync_status: string }>;
    const dbIds = new Set(dbClassrooms.map(c => c.id));

    // Find missing and synced classrooms
    const missing = allFiles.filter(f => !dbIds.has(f.id));
    const synced = dbClassrooms.filter(c => {
      // Check if file exists in filesystem
      const fsFile = allFiles.find(f => f.id === c.id);
      return fsFile !== undefined;
    });

    // Find orphaned database entries (in DB but not in filesystem)
    const orphaned = dbClassrooms.filter(c => !fsIdSet.has(c.id));

    return apiSuccess({
      filesystemCount: fsIds.length,
      databaseCount: dbIds.size,
      syncedCount: synced.length,
      missingCount: missing.length,
      orphanedCount: orphaned.length,
      missing: missing.map(m => ({ id: m.id, ownerId: m.ownerId, storagePath: m.storagePath })),
      syncedClassrooms: synced,
      orphanedClassrooms: orphaned,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to list classrooms',
      error instanceof Error ? error.message : String(error),
    );
  }
}
