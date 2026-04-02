import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  isValidClassroomId,
  getClassroomMetadata,
  updateClassroom,
  CLASSROOMS_DIR,
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

// POST /api/classroom/cover - Upload classroom cover image
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;

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

    // Only owner or admin can update cover
    if (metadata.ownerId !== auth.userId && auth.role !== 'admin') {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('cover') as File | null;

    if (!file) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing cover image file');
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'Invalid file type. Allowed: JPEG, PNG, WebP, GIF'
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'File too large. Maximum size: 5MB'
      );
    }

    // Create covers directory if not exists
    const coversDir = join(CLASSROOMS_DIR, 'covers');
    if (!existsSync(coversDir)) {
      mkdirSync(coversDir, { recursive: true });
    }

    // Generate unique filename
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const filename = `${id}-${randomUUID()}.${ext}`;
    const filePath = join(coversDir, filename);

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer());
    await import('fs/promises').then(fs => fs.writeFile(filePath, buffer));

    // Update classroom metadata with cover image path
    const coverImagePath = `/data/classrooms/covers/${filename}`;
    const success = updateClassroom(id, auth.userId, { coverImage: coverImagePath });

    if (!success) {
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to update cover image');
    }

    return apiSuccess({
      message: 'Cover image uploaded successfully',
      coverImage: coverImagePath,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to upload cover image',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// DELETE /api/classroom/cover - Remove classroom cover image
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;

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

    // Only owner or admin can update cover
    if (metadata.ownerId !== auth.userId && auth.role !== 'admin') {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Access denied');
    }

    // Remove cover image by setting it to null
    const success = updateClassroom(id, auth.userId, { coverImage: null });

    if (!success) {
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to remove cover image');
    }

    return apiSuccess({
      message: 'Cover image removed successfully',
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to remove cover image',
      error instanceof Error ? error.message : String(error),
    );
  }
}
