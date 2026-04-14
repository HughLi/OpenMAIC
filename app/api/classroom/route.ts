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
  updateClassroom,
} from '@/lib/server/classroom-service';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

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

  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes, visibility = 'private' } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

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

    // Save metadata to database with storage path
    saveClassroomMetadata({
      id,
      ownerId: auth.userId,
      title: stage.title || 'Untitled Classroom',
      description: stage.description,
      visibility,
      sceneCount: scenes.length,
      storagePath: persisted.storagePath,
      syncStatus: 'local',
    });

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
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
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      // List user's classrooms - requires auth
      const auth = await requireAuth(request);
      if (auth instanceof Response) return auth;
      const classrooms = listUserClassrooms(auth.userId);
      return apiSuccess({ classrooms });
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    // Get metadata first to check visibility
    const metadata = getClassroomMetadata(id);
    if (!metadata) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    // Public classrooms can be accessed without auth
    let userId: string | null = null;
    let userRole: string = 'viewer';

    if (metadata.visibility === 'public') {
      // Try to get auth info if available, but don't require it
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          const payload = await verifyToken(token) as AccessTokenPayload;
          userId = payload.userId;
          userRole = payload.role;
        } catch {
          // Ignore token errors for public courses
        }
      }
    } else {
      // Private/shared courses require authentication
      const auth = await requireAuth(request);
      if (auth instanceof Response) return auth;
      userId = auth.userId;
      userRole = auth.role;
    }

    // Check access permissions
    if (!canAccessClassroom(id, userId || '', userRole)) {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    // Read classroom with ownerId for new path structure
    const classroom = await readClassroom(id, metadata?.ownerId);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    return apiSuccess({
      classroom,
      metadata,
      isOwner: metadata?.ownerId === userId,
    });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
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

// PATCH /api/classroom - Update classroom metadata (owner or admin only)
export async function PATCH(request: NextRequest) {
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

    // Only owner or admin can update
    if (metadata.ownerId !== auth.userId && auth.role !== 'admin') {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    const body = await request.json();
    const { title, description, category, coverImage, visibility } = body;

    // Validate visibility if provided
    if (visibility && !['private', 'public', 'shared'].includes(visibility)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid visibility value');
    }

    // Update metadata
    const updates: {
      title?: string;
      description?: string;
      category?: string;
      coverImage?: string;
      visibility?: 'private' | 'public' | 'shared';
    } = {};

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (coverImage !== undefined) updates.coverImage = coverImage;
    if (visibility !== undefined) updates.visibility = visibility;

    const success = updateClassroom(id, auth.userId, updates);

    if (!success) {
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to update classroom');
    }

    // Get updated metadata
    const updatedMetadata = getClassroomMetadata(id);

    return apiSuccess({
      message: 'Classroom updated successfully',
      classroom: updatedMetadata,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to update classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
