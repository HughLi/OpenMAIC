/**
 * Media Export Service
 *
 * Exports media files (images, audio, video) from IndexedDB to file system
 * Organized by owner_id/stage_id for multi-user support
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('MediaExportService');

export interface MediaFile {
  id: string;
  blob: Buffer | Blob;
  type: 'image' | 'audio' | 'video';
  mimeType: string;
}

export interface MediaExportResult {
  success: boolean;
  exportedCount: number;
  failedIds: string[];
  errors: string[];
}

export interface MediaExportService {
  /**
   * Export media files to file system
   */
  exportMedia(
    ownerId: string,
    stageId: string,
    mediaFiles: MediaFile[]
  ): Promise<MediaExportResult>;

  /**
   * Get media file public URL
   */
  getMediaUrl(ownerId: string, stageId: string, mediaId: string): string;

  /**
   * Read media file as buffer
   */
  readMedia(ownerId: string, stageId: string, filename: string): Promise<Buffer | null>;

  /**
   * Delete media file
   */
  deleteMedia(ownerId: string, stageId: string, filename: string): Promise<boolean>;
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string, type: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/mp3': '.mp3',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/aac': '.aac',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
  };

  const ext = mimeToExt[mimeType.toLowerCase()];
  if (ext) return ext;

  // Fallback based on type
  const typeToExt: Record<string, string> = {
    image: '.png',
    audio: '.mp3',
    video: '.mp4',
  };

  return typeToExt[type] || '.bin';
}

/**
 * Create media export service instance
 */
export function createMediaExportService(baseDir: string): MediaExportService {
  const getMediaDir = (ownerId: string, stageId: string) =>
    path.join(baseDir, ownerId, stageId, 'media');

  return {
    async exportMedia(
      ownerId: string,
      stageId: string,
      mediaFiles: MediaFile[]
    ): Promise<MediaExportResult> {
      const result: MediaExportResult = {
        success: true,
        exportedCount: 0,
        failedIds: [],
        errors: [],
      };

      if (!ownerId || !stageId) {
        result.success = false;
        result.errors.push('Invalid ownerId or stageId');
        return result;
      }

      const mediaDir = getMediaDir(ownerId, stageId);

      try {
        // Ensure directory exists
        await fs.mkdir(mediaDir, { recursive: true });
      } catch (err) {
        log.error('Failed to create media directory:', err);
        result.success = false;
        result.errors.push(`Failed to create directory: ${err}`);
        return result;
      }

      for (const media of mediaFiles) {
        try {
          // Validate media
          if (!media.id || media.id === '') {
            result.failedIds.push(media.id);
            result.errors.push('Media ID is required');
            continue;
          }

          if (!media.blob || (media.blob as Buffer).length === 0) {
            result.failedIds.push(media.id);
            result.errors.push(`Empty blob for media ${media.id}`);
            continue;
          }

          const extension = getExtensionFromMimeType(media.mimeType, media.type);
          const filename = `${media.id}${extension}`;
          const filePath = path.join(mediaDir, filename);

          // Convert Blob to Buffer if needed
          let buffer: Buffer;
          if (Buffer.isBuffer(media.blob)) {
            buffer = media.blob;
          } else {
            // Convert Web API Blob to Buffer
            const arrayBuffer = await (media.blob as Blob).arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
          }

          // Write file
          await fs.writeFile(filePath, buffer);
          result.exportedCount++;

          log.debug(`Exported media: ${filename} (${buffer.length} bytes)`);
        } catch (err) {
          log.error(`Failed to export media ${media.id}:`, err);
          result.failedIds.push(media.id);
          result.errors.push(`Failed to export ${media.id}: ${err}`);
        }
      }

      result.success = result.failedIds.length === 0;
      return result;
    },

    getMediaUrl(ownerId: string, stageId: string, mediaId: string): string {
      // Extract extension from mediaId if present
      const ext = path.extname(mediaId);
      const baseId = path.basename(mediaId, ext);
      const finalExt = ext || '.png'; // Default to .png if no extension

      return `/api/classroom-files/${ownerId}/${stageId}/media/${baseId}${finalExt}`;
    },

    async readMedia(ownerId: string, stageId: string, filename: string): Promise<Buffer | null> {
      try {
        const mediaDir = getMediaDir(ownerId, stageId);
        const filePath = path.join(mediaDir, filename);

        // Security check: ensure path is within mediaDir
        const resolvedPath = path.resolve(filePath);
        const resolvedMediaDir = path.resolve(mediaDir);
        if (!resolvedPath.startsWith(resolvedMediaDir)) {
          log.warn('Attempted path traversal:', filePath);
          return null;
        }

        const buffer = await fs.readFile(filePath);
        return buffer;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.error('Failed to read media:', err);
        }
        return null;
      }
    },

    async deleteMedia(ownerId: string, stageId: string, filename: string): Promise<boolean> {
      try {
        const mediaDir = getMediaDir(ownerId, stageId);
        const filePath = path.join(mediaDir, filename);

        // Security check
        const resolvedPath = path.resolve(filePath);
        const resolvedMediaDir = path.resolve(mediaDir);
        if (!resolvedPath.startsWith(resolvedMediaDir)) {
          log.warn('Attempted path traversal in delete:', filePath);
          return false;
        }

        await fs.unlink(filePath);
        log.debug(`Deleted media: ${filename}`);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.error('Failed to delete media:', err);
        }
        return false;
      }
    },
  };
}

// Default instance using environment variable or default path
const DEFAULT_BASE_DIR = process.env.CLASSROOM_STORAGE_DIR ||
  path.join(process.cwd(), 'data/classrooms');

export const mediaExportService = createMediaExportService(DEFAULT_BASE_DIR);
