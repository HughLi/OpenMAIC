import { type NextRequest } from 'next/server';
import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { getClassroomMetadata, canAccessClassroom, getClassroomPath } from '@/lib/server/classroom-service';
import { createReadStream } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioServe');

// Resolve project root to ensure correct paths in all environments
const projectRoot = process.env.PROJECT_ROOT || (process.cwd().includes('.next/standalone')
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd());

const CLASSROOMS_DIR = path.join(projectRoot, 'data', 'classrooms');

// Optional auth - public classrooms don't require auth
async function optionalAuth(request: NextRequest): Promise<{ userId: string | null; userRole: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { userId: null, userRole: 'viewer' };
  }

  const token = authHeader.substring(7);
  try {
    const payload = await verifyToken(token) as AccessTokenPayload;
    return { userId: payload.userId, userRole: payload.role };
  } catch {
    return { userId: null, userRole: 'viewer' };
  }
}

/**
 * GET /api/classroom/audio?classroomId=xxx&audioId=xxx
 * Serve audio files for a classroom
 */
export async function GET(request: NextRequest) {
  const { userId, userRole } = await optionalAuth(request);

  try {
    const { searchParams } = new URL(request.url);
    const classroomId = searchParams.get('classroomId');
    const audioId = searchParams.get('audioId');

    if (!classroomId || !audioId) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: classroomId, audioId',
      );
    }

    // Check access permissions
    if (!canAccessClassroom(classroomId, userId || '', userRole)) {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    // Get metadata to find ownerId for new path structure
    const metadata = getClassroomMetadata(classroomId);
    const ownerId = metadata?.ownerId;

    // Find audio file - try new path first, then legacy path
    const extensions = ['mp3', 'wav', 'ogg', 'm4a'];
    let filePath: string | null = null;
    let fileExt = 'mp3';

    // Try new path structure: data/classrooms/{ownerId}/{classroomId}/audio/
    if (ownerId) {
      const audioDir = path.join(getClassroomPath(ownerId, classroomId), 'audio');
      log.info(`Looking for audio in new path: ${audioDir}`);
      for (const ext of extensions) {
        const testPath = path.join(audioDir, `${audioId}.${ext}`);
        log.debug(`Trying: ${testPath}`);
        if (existsSync(testPath)) {
          filePath = testPath;
          fileExt = ext;
          log.info(`Found audio in new path: ${testPath}`);
          break;
        }
      }
    }

    // Try legacy path: data/classrooms/{classroomId}/audio/
    if (!filePath) {
      const legacyAudioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
      log.info(`Looking for audio in legacy path: ${legacyAudioDir}`);
      for (const ext of extensions) {
        const testPath = path.join(legacyAudioDir, `${audioId}.${ext}`);
        log.debug(`Trying: ${testPath}`);
        if (existsSync(testPath)) {
          filePath = testPath;
          fileExt = ext;
          log.info(`Found audio in legacy path: ${testPath}`);
          break;
        }
      }
    }

    if (!filePath) {
      log.warn(`Audio file not found: ${classroomId}/${audioId}, ownerId: ${ownerId}`);
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Audio file not found');
    }

    // Stream audio file
    const stream = createReadStream(filePath);
    const contentType = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
    }[fileExt] || 'audio/mpeg';

    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
  } catch (error) {
    log.error('Audio serve failed:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to serve audio',
      error instanceof Error ? error.message : String(error),
    );
  }
}
