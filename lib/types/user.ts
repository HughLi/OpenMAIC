/**
 * User Types
 */

export type UserRole = 'admin' | 'generator' | 'viewer';
export type UserStatus = 'active' | 'inactive' | 'pending_approval' | 'rejected';

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  loginCount: number;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: UserRole;
  displayName?: string;
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  displayName?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface UserWithToken {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'system' | 'approval' | 'course_status' | 'role_change';
  title: string;
  content: string;
  isRead: boolean;
  data?: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
}
