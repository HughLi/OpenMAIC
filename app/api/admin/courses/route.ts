import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getDatabase } from '@/server/database';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { readFile } from 'fs/promises';
import path from 'path';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-service';

// Helper function to extract cover image from classroom JSON file
async function getClassroomCoverImage(ownerId: string, classroomId: string): Promise<string | null> {
  try {
    // Try new path structure first
    const filePath = path.join(CLASSROOMS_DIR, ownerId, classroomId, 'stage.json');
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Try to get first scene's image
    if (data.scenes && data.scenes.length > 0) {
      const firstScene = data.scenes[0];
      const content = firstScene.content as { canvas?: { elements?: Array<{ type: string; src?: string }> } } | undefined;
      if (content?.canvas?.elements) {
        const imageElement = content.canvas.elements.find(
          (el) => el.type === 'image' && el.src
        );
        if (imageElement?.src) {
          return imageElement.src;
        }
      }
    }

    return null;
  } catch {
    // Try legacy path
    try {
      const legacyPath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);
      const content = await readFile(legacyPath, 'utf-8');
      const data = JSON.parse(content);

      if (data.scenes && data.scenes.length > 0) {
        const firstScene = data.scenes[0];
        const content = firstScene.content as { canvas?: { elements?: Array<{ type: string; src?: string }> } } | undefined;
        if (content?.canvas?.elements) {
          const imageElement = content.canvas.elements.find(
            (el) => el.type === 'image' && el.src
          );
          if (imageElement?.src) {
            return imageElement.src;
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }
}

// Auth middleware - requires admin role
async function requireAdmin(request: NextRequest): Promise<AccessTokenPayload | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Missing authorization header');
  }

  const token = authHeader.substring(7);
  try {
    const payload = await verifyToken(token) as AccessTokenPayload;
    if (payload.role !== 'admin') {
      return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Admin access required');
    }
    return payload;
  } catch {
    return apiError(API_ERROR_CODES.TOKEN_INVALID, 401, 'Invalid token');
  }
}

// GET /api/admin/courses - Get all courses (admin only)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const db = getDatabase();

    // Build query
    // Default: exclude deleted courses unless explicitly filtering for them
    let query = `
      SELECT
        c.id,
        c.owner_id,
        c.title,
        c.description,
        c.category,
        c.cover_image,
        c.visibility,
        c.status,
        c.scene_count,
        c.created_at,
        c.updated_at,
        u.username as owner_name
      FROM classrooms c
      LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.status != 'deleted'
    `;
    const params: unknown[] = [];

    if (status && status !== 'all') {
      query += ' AND c.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (c.title LIKE ? OR c.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY c.updated_at DESC';

    const classrooms = db.prepare(query).all(...params) as Array<{
      id: string;
      owner_id: string;
      title: string;
      description: string | null;
      category: string;
      cover_image: string | null;
      visibility: string;
      status: string;
      scene_count: number;
      created_at: string;
      updated_at: string;
      owner_name: string;
    }>;

    // Transform to Course format with cover images
    const courses = await Promise.all(
      classrooms.map(async (classroom) => {
        // Get cover image from JSON file if not in database
        let coverImage = classroom.cover_image || '';
        if (!coverImage) {
          coverImage = await getClassroomCoverImage(classroom.owner_id, classroom.id) || '';
        }

        return {
          id: classroom.id,
          title: classroom.title,
          description: classroom.description || '',
          coverImage,
          category: classroom.category,
          instructor: {
            id: classroom.owner_id,
            name: classroom.owner_name || 'Unknown',
            avatar: '',
          },
          rating: 4.5, // TODO: Implement rating system
          studentCount: 0, // TODO: Implement enrollment tracking
          status: classroom.status as 'active' | 'inactive' | 'draft',
          createdAt: classroom.created_at,
          updatedAt: classroom.updated_at,
          sceneCount: classroom.scene_count,
          visibility: classroom.visibility,
        };
      })
    );

    // Get stats (exclude deleted courses)
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_courses,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_courses
      FROM classrooms
      WHERE status != 'deleted'
    `).get() as { total_courses: number; active_courses: number };

    return apiSuccess({
      courses,
      stats: {
        totalCourses: stats.total_courses,
        activeCourses: stats.active_courses,
      },
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve courses',
      error instanceof Error ? error.message : String(error),
    );
  }
}
