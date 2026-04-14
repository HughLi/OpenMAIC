import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioStorage');

/**
 * Audio storage source type
 * - 'indexeddb': Use IndexedDB for audio storage (client-side generated courses)
 * - 'server': Use server URLs for audio (server-side generated courses)
 */
export type AudioStorageSource = 'indexeddb' | 'server';

/**
 * Process audio URLs in scenes based on storage source setting
 *
 * @param scenes - Array of scenes to process
 * @param storageSource - The audio storage source to use
 * @returns New array of scenes with audio URLs processed according to storage source
 */
export async function processAudioUrls(
  scenes: Scene[],
  storageSource: AudioStorageSource,
): Promise<Scene[]> {
  // For server storage, return scenes as-is (keep existing audioUrl)
  if (storageSource === 'server') {
    return scenes.map((scene) => ({
      ...scene,
      actions: scene.actions?.map((action) => ({ ...action })),
    }));
  }

  // For IndexedDB storage, clear all audioUrl to force using IndexedDB
  return scenes.map((scene) => {
    const updatedActions = scene.actions?.map((action) => {
      if (action.type === 'speech') {
        const speechAction = action as SpeechAction;
        if (speechAction.audioUrl) {
          log.info(`[Audio] Clearing server URL for: ${speechAction.audioId}, will use IndexedDB`);
          const { audioUrl, ...rest } = speechAction;
          return rest as SpeechAction;
        }
      }
      return { ...action };
    });
    return { ...scene, actions: updatedActions };
  });
}
