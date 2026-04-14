import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getDatabase } from '@/server/database';
import { verifyToken, AccessTokenPayload } from '@/server/auth/jwt';
import { getClassroomFirstSlide, buildRequestOrigin } from '@/lib/server/classroom-service';

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

    console.log('[Admin Courses API] Executing query:', query, 'params:', params);

    const classroomsRaw = db.prepare(query).all(...params);

    // Validate classrooms is an array
    if (!Array.isArray(classroomsRaw)) {
      console.error('[Admin Courses API] Query did not return an array:', classroomsRaw);
      return apiError(
        API_ERROR_CODES.INTERNAL_ERROR,
        500,
        'Invalid database response',
        'Query result is not an array',
      );
    }

    const classrooms = classroomsRaw as Array<{
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

    console.log(`[Admin Courses API] Found ${classrooms.length} classrooms`);

    // Build base URL for media resolution
    const baseUrl = buildRequestOrigin(request);

    // Load first slide for each classroom (for thumbnails) - same as /api/courses
    let classroomsWithSlides;
    try {
      classroomsWithSlides = await Promise.all(
        classrooms.map(async (classroom, index) => {
          try {
            // Validate classroom id
            if (!classroom?.id) {
              console.error(`[Admin Courses API] Invalid classroom at index ${index}:`, classroom);
              return {
                ...classroom,
                firstSlide: null,
              };
            }
            const firstSlide = await getClassroomFirstSlide(classroom.id, baseUrl);
            return {
              ...classroom,
              firstSlide,
            };
          } catch (slideError) {
            console.error(`[Admin Courses API] Error loading first slide for ${classroom?.id}:`, slideError);
            return {
              ...classroom,
              firstSlide: null,
            };
          }
        })
      );
    } catch (promiseError) {
      console.error('[Admin Courses API] Error in Promise.all:', promiseError);
      throw promiseError;
    }

    // Transform to Course format
    const courses = classroomsWithSlides.map(classroom => ({
      id: classroom.id,
      title: classroom.title,
      description: classroom.description || '',
      coverImage: classroom.cover_image || '',
      firstSlide: classroom.firstSlide,
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
    }));

    // Get stats (exclude deleted courses)
    console.log('[Admin Courses API] Getting stats...');
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_courses,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_courses
      FROM classrooms
      WHERE status != 'deleted'
    `).get() as { total_courses: number; active_courses: number };

    console.log('[Admin Courses API] Stats:', stats);

    return apiSuccess({
      courses,
      stats: {
        totalCourses: stats.total_courses,
        activeCourses: stats.active_courses,
      },
    });
  } catch (error) {
    console.error('[Admin Courses API] Error:', error);
    if (error instanceof Error) {
      console.error('[Admin Courses API] Stack:', error.stack);
    }
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve courses',
      error instanceof Error ? error.message : String(error),
    );
  }
}
