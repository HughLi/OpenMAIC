import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { getClassroomMetadata, updateClassroom, getClassroomPath } from '@/lib/server/classroom-service';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioUpload');

// Resolve project root to ensure correct paths in all environments
const projectRoot = process.env.PROJECT_ROOT || (process.cwd().includes('.next/standalone')
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd());

const CLASSROOMS_DIR = path.join(projectRoot, 'data', 'classrooms');

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
 * POST /api/classroom/audio-upload
 * Upload audio files for a classroom (TTS audio)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const classroomId = formData.get('classroomId') as string;
    const audioId = formData.get('audioId') as string;
    const audioFile = formData.get('audio') as File;

    if (!classroomId || !audioId || !audioFile) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: classroomId, audioId, audio',
      );
    }

    // Check if user owns the classroom
    const metadata = getClassroomMetadata(classroomId);
    if (!metadata) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    if (metadata.ownerId !== auth.userId && auth.role !== 'admin') {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    // Determine audio directory path using new path structure
    let audioDir: string;
    if (metadata.ownerId) {
      // New path: data/classrooms/{ownerId}/{classroomId}/audio/
      audioDir = path.join(getClassroomPath(metadata.ownerId, classroomId), 'audio');
    } else {
      // Legacy path: data/classrooms/{classroomId}/audio/
      audioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
    }

    if (!existsSync(audioDir)) {
      await mkdir(audioDir, { recursive: true });
    }

    const fileExt = audioFile.name.split('.').pop() || 'mp3';
    const filename = `${audioId}.${fileExt}`;
    const filePath = path.join(audioDir, filename);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    await writeFile(filePath, buffer);

    log.info(`Audio uploaded: ${classroomId}/${filename} (${buffer.length} bytes)`);

    return apiSuccess({
      audioId,
      url: `/api/classroom/audio?classroomId=${classroomId}&audioId=${audioId}`,
    });
  } catch (error) {
    log.error('Audio upload failed:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to upload audio',
      error instanceof Error ? error.message : String(error),
    );
  }
}
