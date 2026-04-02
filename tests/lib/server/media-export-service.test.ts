import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import {
  MediaExportService,
  createMediaExportService,
} from '@/lib/server/media-export-service';

const TEST_DIR = path.join(process.cwd(), 'data/test/classrooms');

describe('MediaExportService', () => {
  let service: MediaExportService;

  beforeAll(async () => {
    // Ensure test directory exists
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    // Clean up test directory
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    service = createMediaExportService(TEST_DIR);
    // Clean up test directory before each test
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  describe('exportMedia', () => {
    it('should export image media to file system', async () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaFiles = [
        {
          id: 'img_1',
          blob: Buffer.from('fake-image-data'),
          type: 'image' as const,
          mimeType: 'image/png',
        },
      ];

      const result = await service.exportMedia(ownerId, stageId, mediaFiles);

      expect(result.success).toBe(true);
      expect(result.exportedCount).toBe(1);
      expect(result.failedIds).toHaveLength(0);

      // Verify file was created
      const filePath = path.join(TEST_DIR, ownerId, stageId, 'media', 'img_1.png');
      const fileContent = await fs.readFile(filePath);
      expect(fileContent.toString()).toBe('fake-image-data');
    });

    it('should export multiple media files', async () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaFiles = [
        {
          id: 'img_1',
          blob: Buffer.from('image-1'),
          type: 'image' as const,
          mimeType: 'image/png',
        },
        {
          id: 'audio_1',
          blob: Buffer.from('audio-1'),
          type: 'audio' as const,
          mimeType: 'audio/mp3',
        },
        {
          id: 'video_1',
          blob: Buffer.from('video-1'),
          type: 'video' as const,
          mimeType: 'video/mp4',
        },
      ];

      const result = await service.exportMedia(ownerId, stageId, mediaFiles);

      expect(result.success).toBe(true);
      expect(result.exportedCount).toBe(3);
    });

    it('should use correct file extensions based on mime type', async () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaFiles = [
        {
          id: 'img',
          blob: Buffer.from('data'),
          type: 'image' as const,
          mimeType: 'image/jpeg',
        },
      ];

      await service.exportMedia(ownerId, stageId, mediaFiles);

      const jpegPath = path.join(TEST_DIR, ownerId, stageId, 'media', 'img.jpg');
      await expect(fs.access(jpegPath)).resolves.not.toThrow();
    });

    it('should return failed IDs for invalid media', async () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaFiles = [
        {
          id: '',
          blob: Buffer.from('data'),
          type: 'image' as const,
          mimeType: 'image/png',
        },
      ];

      const result = await service.exportMedia(ownerId, stageId, mediaFiles);

      expect(result.success).toBe(false);
      expect(result.failedIds).toContain('');
    });

    it('should create user and stage directories if not exist', async () => {
      const ownerId = 'new-user';
      const stageId = 'new-stage';

      await service.exportMedia(ownerId, stageId, [
        {
          id: 'img_1',
          blob: Buffer.from('data'),
          type: 'image',
          mimeType: 'image/png',
        },
      ]);

      const mediaDir = path.join(TEST_DIR, ownerId, stageId, 'media');
      const stats = await fs.stat(mediaDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('getMediaUrl', () => {
    it('should return correct media URL', () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaId = 'img_1';

      const url = service.getMediaUrl(ownerId, stageId, mediaId);

      expect(url).toBe(`/api/classroom-files/${ownerId}/${stageId}/media/img_1.png`);
    });
  });

  describe('readMedia', () => {
    it('should read media file as buffer', async () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaFiles = [
        {
          id: 'img_1',
          blob: Buffer.from('test-content'),
          type: 'image' as const,
          mimeType: 'image/png',
        },
      ];

      await service.exportMedia(ownerId, stageId, mediaFiles);

      const buffer = await service.readMedia(ownerId, stageId, 'img_1.png');

      expect(buffer).not.toBeNull();
      expect(buffer?.toString()).toBe('test-content');
    });

    it('should return null for non-existent media', async () => {
      const buffer = await service.readMedia('user-123', 'stage-456', 'non-existent.png');
      expect(buffer).toBeNull();
    });
  });

  describe('deleteMedia', () => {
    it('should delete media file', async () => {
      const ownerId = 'user-123';
      const stageId = 'stage-456';
      const mediaFiles = [
        {
          id: 'img_1',
          blob: Buffer.from('data'),
          type: 'image' as const,
          mimeType: 'image/png',
        },
      ];

      await service.exportMedia(ownerId, stageId, mediaFiles);
      await service.deleteMedia(ownerId, stageId, 'img_1.png');

      const buffer = await service.readMedia(ownerId, stageId, 'img_1.png');
      expect(buffer).toBeNull();
    });
  });
});
