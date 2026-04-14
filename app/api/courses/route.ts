import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  getClassroomFirstSlide,
  buildRequestOrigin,
} from '@/lib/server/classroom-service';
import { getDatabase } from '@/server/database';
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

// GET /api/courses - Get visible courses based on user role
// - viewer: only public courses
// - generator: public courses + own private courses
// - admin: all courses
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    // Get active classrooms based on user role
    const db = getDatabase();
    let query = `
      SELECT c.id, c.owner_id, c.title, c.description, c.category, c.cover_image,
             c.visibility, c.status, c.scene_count, c.created_at, c.updated_at,
             u.username as author_name
      FROM classrooms c
      LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.status = 'active'
    `;
    const params: (string | number)[] = [];

    // Filter by visibility based on user role
    if (auth.role === 'viewer') {
      // Viewers can only see public courses
      query += ` AND c.visibility = 'public'`;
    } else if (auth.role === 'generator') {
      // Generators can see public courses + their own private courses
      query += ` AND (c.visibility = 'public' OR c.owner_id = ?)`;
      params.push(auth.userId);
    }
    // Admin can see all courses (no visibility filter)

    if (category && category !== 'all') {
      query += ` AND c.category = ?`;
      params.push(category);
    }

    query += ` ORDER BY c.created_at DESC`;

    const classroomsRaw = db.prepare(query).all(...params);

    // Validate classrooms is an array
    if (!Array.isArray(classroomsRaw)) {
      console.error('[Courses API] Query did not return an array:', classroomsRaw);
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
      author_name: string | null;
    }>;

    console.log(`[Courses API] Found ${classrooms.length} classrooms`);

    // Build base URL for media resolution
    const baseUrl = buildRequestOrigin(request);

    // Load first slide for each classroom (for thumbnails)
    let classroomsWithSlides;
    try {
      classroomsWithSlides = await Promise.all(
        classrooms.map(async (classroom, index) => {
          try {
            // Validate classroom id
            if (!classroom?.id) {
              console.error(`[Courses API] Invalid classroom at index ${index}:`, classroom);
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
            console.error(`[Courses API] Error loading first slide for ${classroom?.id}:`, slideError);
            return {
              ...classroom,
              firstSlide: null,
            };
          }
        })
      );
    } catch (promiseError) {
      console.error('[Courses API] Error in Promise.all:', promiseError);
      throw promiseError;
    }

    // Transform to Course format
    const courses = classroomsWithSlides.map(classroom => ({
      id: classroom.id,
      title: classroom.title,
      description: classroom.description || '',
      coverImage: classroom.cover_image || '',
      firstSlide: classroom.firstSlide,
      category: classroom.category as CourseCategory,
      instructor: {
        id: classroom.owner_id,
        name: classroom.author_name || '课程作者',
        avatar: '',
      },
      rating: 4.5,
      studentCount: 0,
      status: classroom.status,
      createdAt: classroom.created_at,
      updatedAt: classroom.updated_at,
    }));

    return apiSuccess({ courses });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve courses',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Type for course category
export type CourseCategory =
  | 'all'
  | 'programming'
  | 'design'
  | 'business'
  | 'data-science'
  | 'language'
  | 'marketing'
  | 'other';
