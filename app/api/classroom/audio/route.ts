import { type NextRequest } from 'next/server';
import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { getClassroomMetadata, canAccessClassroom } from '@/lib/server/classroom-service';
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
    if (!canAccessClassroom(classroomId, userId, userRole)) {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    // Find audio file
    const audioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
    const extensions = ['mp3', 'wav', 'ogg', 'm4a'];
    let filePath: string | null = null;
    let fileExt = 'mp3';

    for (const ext of extensions) {
      const testPath = path.join(audioDir, `${audioId}.${ext}`);
      if (existsSync(testPath)) {
        filePath = testPath;
        fileExt = ext;
        break;
      }
    }

    if (!filePath) {
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
