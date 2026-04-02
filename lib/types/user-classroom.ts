// User Classroom Types - Database Storage

export interface UserClassroom {
  id: string;
  userId: string;
  classroomId: string;
  name: string;
  description?: string;
  sceneCount: number;
  coverImage?: string;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserClassroomInput {
  classroomId: string;
  name: string;
  description?: string;
  sceneCount?: number;
  coverImage?: string;
}

export interface UpdateUserClassroomInput {
  name?: string;
  description?: string;
  sceneCount?: number;
  coverImage?: string;
  lastAccessedAt?: string;
}

export interface UserClassroomListItem {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  coverImage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserClassroomFilters {
  search?: string;
  page?: number;
  limit?: number;
}

export interface UserClassroomListResponse {
  classrooms: UserClassroomListItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
