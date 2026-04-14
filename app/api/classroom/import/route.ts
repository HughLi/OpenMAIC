import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { saveClassroomMetadata, persistClassroom, ensureClassroomsDir } from '@/lib/server/classroom-service';
import { createUserClassroom } from '@/lib/server/user-classroom-service';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { createLogger } from '@/lib/logger';
import path from 'path';

const log = createLogger('ClassroomImport');

// Debug database path
const projectRoot = process.env.PROJECT_ROOT || (process.cwd().includes('.next/standalone')
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd());
const dbPath = process.env.DATABASE_PATH || path.join(projectRoot, 'data', 'database', 'openmaic.db');
log.info(`[ClassroomImport] Database path: ${dbPath}, cwd: ${process.cwd()}`);

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

/**
 * POST /api/classroom/import
 * Import classroom metadata from JSON (for migrating localStorage courses to database)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const classrooms = Array.isArray(body) ? body : [body];

    log.info(`Importing ${classrooms.length} classrooms for user ${auth.userId}`);

    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
      ids: [] as string[],
    };

    for (const data of classrooms) {
      try {
        const id = data.id || data.stage?.id;
        const name = data.name || data.title || data.stage?.name || 'Untitled Course';
        const description = data.description || data.stage?.description;
        const category = data.category || 'other';
        const language = data.language || data.stage?.language || 'zh-CN';
        const style = data.style || data.stage?.style;
        const scenes = data.scenes || [];
        const createdAt = data.createdAt || data.stage?.createdAt || Date.now();

        if (!id) {
          results.errors.push(`Skipped item without ID: ${name}`);
          continue;
        }

        log.info(`Importing classroom: ${id} - ${name}`);

        // Save metadata to database
        saveClassroomMetadata({
          id,
          ownerId: auth.userId,
          title: name,
          description,
          category,
          visibility: 'public',
          sceneCount: scenes.length,
        });

        log.info(`Saved metadata for: ${id}`);

        // Also save full data to file system if scenes exist
        if (scenes.length > 0) {
          await ensureClassroomsDir();
          log.info(`Persisting ${scenes.length} scenes for: ${id}`);

          await persistClassroom(
            {
              id,
              stage: {
                id,
                name,
                description,
                language,
                style,
                createdAt: typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt,
                updatedAt: Date.now(),
              },
              scenes,
            },
            '', // baseUrl not needed for import
          );

          log.info(`Persisted classroom files for: ${id}`);
        }

        // Also save to user_classrooms for "recent learning" feature
        const coverImage = data.coverImage || data.cover_image || data.stage?.coverImage;
        const userClassroomResult = createUserClassroom(auth.userId, {
          classroomId: id,
          name,
          description,
          sceneCount: scenes.length,
          coverImage,
        });

        if (userClassroomResult.success) {
          log.info(`Saved to user_classrooms: ${id}`);
        } else {
          log.warn(`Failed to save to user_classrooms: ${id}`, userClassroomResult.error);
        }

        results.imported++;
        results.ids.push(id);
        log.info(`Successfully imported: ${id}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`Failed to import ${data.name || data.id}:`, err);
        results.errors.push(`Failed to import ${data.name || data.id}: ${errorMsg} (db: ${dbPath})`);
      }
    }

    log.info(`Import complete: ${results.imported} imported, ${results.errors.length} errors`);

    return apiSuccess({
      message: `Imported ${results.imported} classrooms, skipped ${results.skipped}`,
      ...results,
    });
  } catch (error) {
    log.error('Import failed:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to import classrooms',
      error instanceof Error ? error.message : String(error),
    );
  }
}
