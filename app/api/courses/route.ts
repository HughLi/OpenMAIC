import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  getClassroomFirstSlide,
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

// GET /api/courses - Get all visible courses (all users can see all active courses)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    // Get all active classrooms from database (all users see all courses)
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

    if (category && category !== 'all') {
      query += ` AND c.category = ?`;
      params.push(category);
    }

    query += ` ORDER BY c.created_at DESC`;

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
      author_name: string | null;
    }>;

    // Load first slide for each classroom (for thumbnails)
    const classroomsWithSlides = await Promise.all(
      classrooms.map(async (classroom) => {
        const firstSlide = await getClassroomFirstSlide(classroom.id);
        return {
          ...classroom,
          firstSlide,
        };
      })
    );

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
