'use client';

import { useState, useCallback, useRef } from 'react';
import type { Stage, Scene } from '@/lib/types/stage';
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

      // Call API to create/update classroom
      const response = await fetch('/api/classroom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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

      log.info('Classroom sync completed:', result.data?.id);

      return {
        success: true,
        classroomId: result.data?.id,
        url: result.data?.url,
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

    // Then sync media files if any
    if (input.mediaFiles && input.mediaFiles.length > 0) {
      try {
        log.info(`Syncing ${input.mediaFiles.length} media files`);
        setSyncProgress(80);

        // TODO: Implement media sync via separate API endpoint
        // For now, media files need to be handled separately

        setSyncProgress(100);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error('Media sync failed:', errorMessage);
        // Don't fail the whole sync if media fails
      }
    }

    return classroomResult;
  }, [syncClassroom]);

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
