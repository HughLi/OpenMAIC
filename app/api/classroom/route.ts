import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
  saveClassroomMetadata,
  getClassroomMetadata,
  canAccessClassroom,
  deleteClassroom,
  listUserClassrooms,
} from '@/lib/server/classroom-service';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';

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

// POST /api/classroom - Create new classroom (generator or admin only)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // Check if user has generator permissions
  if (auth.role === 'viewer') {
    return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Generator access required');
  }

  try {
    const body = await request.json();
    const { stage, scenes, visibility = 'private' } = body;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    // Save classroom data
    const persisted = await persistClassroom(
      { id, stage: { ...stage, id }, scenes, ownerId: auth.userId },
      baseUrl
    );

    // Save metadata to database
    saveClassroomMetadata({
      id,
      ownerId: auth.userId,
      title: stage.title || 'Untitled Classroom',
      description: stage.description,
      visibility,
      sceneCount: scenes.length,
    });

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// GET /api/classroom - Get classroom by ID
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      // List user's classrooms
      const classrooms = listUserClassrooms(auth.userId);
      return apiSuccess({ classrooms });
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    // Check access permissions
    if (!canAccessClassroom(id, auth.userId, auth.role)) {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    const metadata = getClassroomMetadata(id);

    return apiSuccess({
      classroom,
      metadata,
      isOwner: metadata?.ownerId === auth.userId,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// DELETE /api/classroom - Delete classroom (owner or admin only)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing classroom id');
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    // Get metadata to check ownership
    const metadata = getClassroomMetadata(id);
    if (!metadata) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    // Only owner or admin can delete
    if (metadata.ownerId !== auth.userId && auth.role !== 'admin') {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    const success = await deleteClassroom(id);
    if (!success) {
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to delete classroom');
    }

    return apiSuccess({ message: 'Classroom deleted successfully' });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to delete classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
