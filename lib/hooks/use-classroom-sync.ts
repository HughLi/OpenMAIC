'use client';

import { useState, useCallback, useRef } from 'react';
import type { Stage, Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('useClassroomSync');

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface MediaFile {
  id: string;
  blob: Blob;
  type: 'image' | 'audio' | 'video';
}

export interface SyncClassroomInput {
  stage: Stage;
  scenes: Scene[];
  ownerId: string;
  visibility?: 'private' | 'public' | 'shared';
}

export interface SyncWithMediaInput extends SyncClassroomInput {
  mediaFiles: MediaFile[];
}

export interface SyncResult {
  success: boolean;
  classroomId?: string;
  url?: string;
  error?: string;
}

export interface UseClassroomSyncReturn {
  syncStatus: SyncStatus;
  syncProgress: number;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  error: string | null;
  syncClassroom: (input: SyncClassroomInput) => Promise<SyncResult>;
  syncWithMedia: (input: SyncWithMediaInput) => Promise<SyncResult>;
  retrySync: () => Promise<SyncResult>;
  resetSync: () => void;
}

/**
 * Hook for syncing classroom data to cloud storage
 * Supports both metadata-only sync and full sync with media files
 */
export function useClassroomSync(): UseClassroomSyncReturn {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store last sync input for retry
  const lastSyncInputRef = useRef<SyncClassroomInput | SyncWithMediaInput | null>(null);
  const isSyncingRef = useRef(false);

  const syncClassroom = useCallback(async (input: SyncClassroomInput): Promise<SyncResult> => {
    // Prevent concurrent syncs
    if (isSyncingRef.current) {
      log.warn('Sync already in progress, skipping');
      return { success: false, error: 'Sync already in progress' };
    }

    // Validate input
    if (!input.stage) {
      return { success: false, error: 'Stage is required' };
    }

    if (!input.ownerId) {
      return { success: false, error: 'Owner ID is required' };
    }

    isSyncingRef.current = true;
    lastSyncInputRef.current = input;
    setSyncStatus('syncing');
    setSyncProgress(0);
    setError(null);

    try {
      log.info('Starting classroom sync:', input.stage.id);

      // Prepare request body
      const body = {
        stage: {
          ...input.stage,
          id: input.stage.id,
          name: input.stage.name || 'Untitled Classroom',
        },
        scenes: input.scenes || [],
        visibility: input.visibility || 'private',
      };

      setSyncProgress(30);

      // Get auth token
      const tokenData = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!)
        : null;
      const token = tokenData?.accessToken;

      // Call API to create/update classroom
      const response = await fetch('/api/classroom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      setSyncProgress(70);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sync classroom');
      }

      setSyncProgress(100);
      setSyncStatus('synced');
      setLastSyncTime(new Date());

      log.info('Classroom sync completed:', result.id);

      return {
        success: true,
        classroomId: result.id,
        url: result.url,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error('Classroom sync failed:', errorMessage);

      setSyncStatus('error');
      setError(errorMessage);

      return { success: false, error: errorMessage };
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  const syncWithMedia = useCallback(async (input: SyncWithMediaInput): Promise<SyncResult> => {
    // First sync classroom metadata
    const classroomResult = await syncClassroom(input);

    if (!classroomResult.success) {
      return classroomResult;
    }

    const classroomId = classroomResult.classroomId!;

    // Sync audio files from IndexedDB
    await syncAudioFiles(input, classroomId);

    // Then sync media files if any
    if (input.mediaFiles && input.mediaFiles.length > 0) {
      try {
        log.info(`Syncing ${input.mediaFiles.length} media files`);
        setSyncProgress(80);

        // Upload media files
        for (const mediaFile of input.mediaFiles) {
          const formData = new FormData();
          formData.append('classroomId', classroomId);
          formData.append('mediaId', mediaFile.id);
          formData.append('media', mediaFile.blob);
          formData.append('type', mediaFile.type);

          await fetch('/api/classroom/media-upload', {
            method: 'POST',
            body: formData,
          });
        }

        setSyncProgress(100);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error('Media sync failed:', errorMessage);
        // Don't fail the whole sync if media fails
      }
    }

    return classroomResult;
  }, [syncClassroom]);

  // Sync audio files from IndexedDB to server
  const syncAudioFiles = useCallback(async (input: SyncClassroomInput, classroomId: string): Promise<void> => {
    try {
      // Get auth token
      const tokenData = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!)
        : null;
      const token = tokenData?.accessToken;

      // Extract audio IDs from speech actions
      const audioIds: string[] = [];
      for (const scene of input.scenes || []) {
        for (const action of scene.actions || []) {
          if (action.type === 'speech') {
            const speechAction = action as SpeechAction;
            if (speechAction.audioId) {
              audioIds.push(speechAction.audioId);
            }
          }
        }
      }

      if (audioIds.length === 0) {
        log.info('No audio files to sync');
        return;
      }

      log.info(`Syncing ${audioIds.length} audio files`);
      setSyncProgress(75);

      // Upload each audio file
      let uploadedCount = 0;
      for (const audioId of audioIds) {
        const audioRecord = await db.audioFiles.get(audioId);
        if (!audioRecord) {
          log.warn(`Audio file not found in IndexedDB: ${audioId}`);
          continue;
        }

        const formData = new FormData();
        formData.append('classroomId', classroomId);
        formData.append('audioId', audioId);
        formData.append('audio', audioRecord.blob, `${audioId}.${audioRecord.format}`);

        const response = await fetch('/api/classroom/audio-upload', {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
          body: formData,
        });

        if (!response.ok) {
          log.warn(`Failed to upload audio ${audioId}:`, await response.text());
        } else {
          uploadedCount++;
        }
      }

      log.info(`Audio sync complete: ${uploadedCount}/${audioIds.length} uploaded`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error('Audio sync failed:', errorMessage);
      // Don't fail the whole sync if audio fails
    }
  }, []);

  const retrySync = useCallback(async (): Promise<SyncResult> => {
    const lastInput = lastSyncInputRef.current;

    if (!lastInput) {
      return { success: false, error: 'No previous sync to retry' };
    }

    log.info('Retrying sync for:', lastInput.stage.id);

    // Reset state before retry
    setSyncStatus('idle');
    setError(null);

    if ('mediaFiles' in lastInput && lastInput.mediaFiles) {
      return syncWithMedia(lastInput as SyncWithMediaInput);
    }

    return syncClassroom(lastInput);
  }, [syncClassroom, syncWithMedia]);

  const resetSync = useCallback(() => {
    setSyncStatus('idle');
    setSyncProgress(0);
    setError(null);
    lastSyncInputRef.current = null;
    isSyncingRef.current = false;
    log.debug('Sync state reset');
  }, []);

  return {
    syncStatus,
    syncProgress,
    isSyncing: syncStatus === 'syncing',
    lastSyncTime,
    error,
    syncClassroom,
    syncWithMedia,
    retrySync,
    resetSync,
  };
}
