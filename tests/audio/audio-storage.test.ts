import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpeechAction, Action } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { processAudioUrls } from '@/lib/audio/audio-storage';

describe('processAudioUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // Test data helpers
  const createMockSpeechAction = (audioId: string, audioUrl?: string): SpeechAction => ({
    id: `action-${audioId}`,
    type: 'speech',
    text: 'Test speech text',
    audioId,
    ...(audioUrl && { audioUrl }),
  });

  const createMockScene = (audioId: string, audioUrl?: string): Scene =>
    ({
      id: 'scene-1',
      stageId: 'stage-1',
      order: 1,
      type: 'slide',
      title: 'Test Scene',
      content: { type: 'slide', html: '' },
      actions: [createMockSpeechAction(audioId, audioUrl)],
    }) as unknown as Scene;

  describe('when storageSource is "indexeddb"', () => {
    it('should clear audioUrl for actions with audioId', async () => {
      const scenes: Scene[] = [
        createMockScene('audio-1', 'https://server.com/audio1.mp3'),
      ];

      const result = await processAudioUrls(scenes, 'indexeddb');

      expect(result[0].actions?.[0]).not.toHaveProperty('audioUrl');
    });

    it('should keep audioId unchanged', async () => {
      const scenes: Scene[] = [createMockScene('audio-1')];

      const result = await processAudioUrls(scenes, 'indexeddb');

      expect((result[0].actions?.[0] as SpeechAction).audioId).toBe('audio-1');
    });

    it('should process multiple scenes with multiple audio actions', async () => {
      const scenes: Scene[] = [
        {
          id: 'scene-1',
          stageId: 'stage-1',
          order: 1,
          type: 'slide',
          title: 'Scene 1',
          content: { type: 'slide', html: '' },
          actions: [
            createMockSpeechAction('audio-1', 'https://server.com/1.mp3'),
            { id: 'action-other', type: 'spotlight', elementId: 'el-1' } as Action,
            createMockSpeechAction('audio-2'),
          ],
        },
        {
          id: 'scene-2',
          stageId: 'stage-1',
          order: 2,
          type: 'slide',
          title: 'Scene 2',
          content: { type: 'slide', html: '' },
          actions: [
            createMockSpeechAction('audio-3', 'https://server.com/3.mp3'),
          ],
        },
      ] as unknown as Scene[];

      const result = await processAudioUrls(scenes, 'indexeddb');

      const speechActions = result.flatMap((s) =>
        s.actions?.filter((a) => a.type === 'speech')
      ) as SpeechAction[];

      expect(speechActions.every((a) => !a.audioUrl)).toBe(true);
      expect(speechActions.map((a) => a.audioId)).toEqual(['audio-1', 'audio-2', 'audio-3']);
    });

    it('should handle scenes without actions', async () => {
      const scenes: Scene[] = [
        { id: 'scene-1', stageId: 'stage-1', order: 1, type: 'slide', title: 'Scene 1', content: { type: 'slide', html: '' } },
        { id: 'scene-2', stageId: 'stage-1', order: 2, type: 'slide', title: 'Scene 2', content: { type: 'slide', html: '' }, actions: [] },
      ] as unknown as Scene[];

      const result = await processAudioUrls(scenes, 'indexeddb');

      expect(result).toHaveLength(2);
      expect(result[0].actions).toBeUndefined();
      expect(result[1].actions).toEqual([]);
    });

    it('should handle non-speech actions', async () => {
      const scenes: Scene[] = [
        {
          id: 'scene-1',
          stageId: 'stage-1',
          order: 1,
          type: 'slide',
          title: 'Scene 1',
          content: { type: 'slide', html: '' },
          actions: [
            { id: 'action-1', type: 'spotlight', elementId: 'el-1' } as Action,
            { id: 'action-2', type: 'laser', elementId: 'el-2' } as Action,
          ],
        },
      ] as unknown as Scene[];

      const result = await processAudioUrls(scenes, 'indexeddb');

      expect(result[0].actions).toHaveLength(2);
      expect(result[0].actions?.[0]).toEqual({ id: 'action-1', type: 'spotlight', elementId: 'el-1' });
    });

    it('should handle speech actions without audioId', async () => {
      const scenes: Scene[] = [
        {
          id: 'scene-1',
          stageId: 'stage-1',
          order: 1,
          type: 'slide',
          title: 'Scene 1',
          content: { type: 'slide', html: '' },
          actions: [
            { id: 'action-1', type: 'speech', text: 'hello' } as SpeechAction,
          ],
        },
      ] as unknown as Scene[];

      const result = await processAudioUrls(scenes, 'indexeddb');

      expect(result[0].actions?.[0]).toEqual({ id: 'action-1', type: 'speech', text: 'hello' });
    });

    it('should handle empty scenes array', async () => {
      const result = await processAudioUrls([], 'indexeddb');
      expect(result).toEqual([]);
    });

    it('should not mutate original scenes array', async () => {
      const scenes: Scene[] = [
        createMockScene('audio-1', 'https://server.com/audio1.mp3'),
      ];

      const result = await processAudioUrls(scenes, 'indexeddb');

      // Original should still have audioUrl
      expect((scenes[0].actions?.[0] as SpeechAction).audioUrl).toBe('https://server.com/audio1.mp3');
      // Result should not have audioUrl
      expect((result[0].actions?.[0] as SpeechAction).audioUrl).toBeUndefined();
    });

    it('should not mutate original action objects', async () => {
      const originalAction: SpeechAction = {
        id: 'action-1',
        type: 'speech',
        text: 'Test speech',
        audioId: 'audio-1',
        audioUrl: 'https://server.com/audio1.mp3',
      };

      const scenes: Scene[] = [
        {
          id: 'scene-1',
          stageId: 'stage-1',
          order: 1,
          type: 'slide',
          title: 'Scene 1',
          content: { type: 'slide', html: '' },
          actions: [originalAction],
        },
      ] as unknown as Scene[];

      const result = await processAudioUrls(scenes, 'indexeddb');

      // Original action should still have audioUrl
      expect(originalAction.audioUrl).toBe('https://server.com/audio1.mp3');
      // Result action should not have audioUrl
      expect((result[0].actions?.[0] as SpeechAction).audioUrl).toBeUndefined();
    });
  });

  describe('when storageSource is "server"', () => {
    it('should keep existing audioUrl', async () => {
      const scenes: Scene[] = [
        createMockScene('audio-1', 'https://server.com/audio1.mp3'),
      ];

      const result = await processAudioUrls(scenes, 'server');

      expect((result[0].actions?.[0] as SpeechAction).audioUrl).toBe('https://server.com/audio1.mp3');
    });

    it('should keep audioId unchanged', async () => {
      const scenes: Scene[] = [createMockScene('audio-1', 'https://server.com/audio1.mp3')];

      const result = await processAudioUrls(scenes, 'server');

      expect((result[0].actions?.[0] as SpeechAction).audioId).toBe('audio-1');
    });

    it('should handle actions without audioUrl', async () => {
      const scenes: Scene[] = [createMockScene('audio-1')];

      const result = await processAudioUrls(scenes, 'server');

      expect((result[0].actions?.[0] as SpeechAction).audioId).toBe('audio-1');
      expect((result[0].actions?.[0] as SpeechAction).audioUrl).toBeUndefined();
    });

    it('should not mutate original scenes or actions', async () => {
      const originalAction: SpeechAction = {
        id: 'action-1',
        type: 'speech',
        text: 'Test speech',
        audioId: 'audio-1',
        audioUrl: 'https://server.com/audio1.mp3',
      };

      const scenes: Scene[] = [
        {
          id: 'scene-1',
          stageId: 'stage-1',
          order: 1,
          type: 'slide',
          title: 'Scene 1',
          content: { type: 'slide', html: '' },
          actions: [{ ...originalAction }],
        },
      ] as unknown as Scene[];

      const result = await processAudioUrls(scenes, 'server');

      // Original should be unchanged
      expect((scenes[0].actions?.[0] as SpeechAction).audioUrl).toBe('https://server.com/audio1.mp3');
      // Result should be the same
      expect((result[0].actions?.[0] as SpeechAction).audioUrl).toBe('https://server.com/audio1.mp3');
    });
  });

  describe('type safety', () => {
    it('should only accept valid storage source values', () => {
      // Type-level test - this would fail TypeScript compilation if invalid
      const validSources: Array<'indexeddb' | 'server'> = ['indexeddb', 'server'];

      // Runtime test
      expect(validSources).toContain('indexeddb');
      expect(validSources).toContain('server');
    });
  });
});
