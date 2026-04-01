import { SignJWT, jwtVerify } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'openmaic-dev-secret-change-in-production'
);
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export type UserRole = 'admin' | 'generator' | 'viewer';

export interface TokenPayload {
  userId: string;
  username: string;
  role: UserRole;
  type: 'access' | 'refresh';
}

export interface AccessTokenPayload extends TokenPayload {
  type: 'access';
}

export interface RefreshTokenPayload extends TokenPayload {
  type: 'refresh';
  tokenId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function generateAccessToken(payload: Omit<AccessTokenPayload, 'type'>): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function generateRefreshToken(payload: Omit<RefreshTokenPayload, 'type' | 'tokenId'>): Promise<string> {
  const tokenId = uuidv4();
  const token = await new SignJWT({ ...payload, type: 'refresh', tokenId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${REFRESH_TOKEN_EXPIRY_DAYS}d`)
    .sign(JWT_SECRET);

  // Store refresh token hash in database
  const db = getDatabase();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenId, payload.userId, token, expiresAt.toISOString());

  return token;
}

export async function generateTokenPair(userId: string, username: string, role: UserRole): Promise<TokenPair> {
  const accessToken = await generateAccessToken({ userId, username, role });
  const refreshToken = await generateRefreshToken({ userId, username, role });

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60 // 15 minutes in seconds
  };
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as unknown as TokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const payload = await verifyToken(token) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  // Check if token exists and is not revoked in database
  const db = getDatabase();
  const stored = db.prepare(`
    SELECT * FROM refresh_tokens WHERE id = ? AND revoked_at IS NULL
  `).get(payload.tokenId) as { expires_at: string } | undefined;

  if (!stored) {
    throw new Error('Refresh token not found or revoked');
  }

  if (new Date(stored.expires_at) < new Date()) {
    throw new Error('Refresh token expired');
  }

  return payload;
}

export function revokeRefreshToken(tokenId: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?
  `).run(tokenId);
}

export function revokeAllUserRefreshTokens(userId: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?
  `).run(userId);
}
