import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioSettings } from './audio-settings';

// Mock the settings store
const mockSetAudioStorageSource = vi.fn();
let mockAudioStorageSource: 'indexeddb' | 'server' = 'indexeddb';

const createMockState = (overrides = {}) => ({
  // Audio storage source
  audioStorageSource: mockAudioStorageSource,
  setAudioStorageSource: mockSetAudioStorageSource,

  // TTS state
  ttsProviderId: 'openai-tts' as const,
  ttsVoice: 'alloy',
  ttsProvidersConfig: {},
  setTTSProvider: vi.fn(),
  setTTSVoice: vi.fn(),
  setTTSProviderConfig: vi.fn(),

  // ASR state
  asrProviderId: 'openai-whisper' as const,
  asrLanguage: 'zh-CN',
  asrProvidersConfig: {},
  setASRProvider: vi.fn(),
  setASRLanguage: vi.fn(),
  setASRProviderConfig: vi.fn(),

  ttsEnabled: true,
  asrEnabled: true,
  setTTSEnabled: vi.fn(),
  setASREnabled: vi.fn(),

  ...overrides,
});

let mockStoreState = createMockState();

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: vi.fn((selector?: (state: unknown) => unknown) => {
    if (selector) {
      return selector(mockStoreState);
    }
    return mockStoreState;
  }),
}));

// Mock i18n
vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.audioStorageSource': '音频存储位置',
        'settings.audioStorageSourceDescription': '选择音频文件的存储方式',
        'settings.storageIndexedDB': '本地存储 (IndexedDB)',
        'settings.storageServer': '服务器存储',
        'settings.storageIndexedDBDescription': '音频保存在浏览器本地，适合离线使用',
        'settings.storageServerDescription': '音频保存在服务器，适合多设备同步',
        'settings.ttsSection': '语音合成 (TTS)',
        'settings.ttsEnabledDescription': '启用语音合成功能',
        'settings.ttsProvider': 'TTS 提供商',
        'settings.ttsVoiceConfigHint': '配置语音合成参数',
        'settings.asrSection': '语音识别 (ASR)',
        'settings.asrEnabledDescription': '启用语音识别功能',
        'settings.asrProvider': 'ASR 提供商',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock audio constants
vi.mock('@/lib/audio/constants', () => ({
  TTS_PROVIDERS: {
    'openai-tts': {
      id: 'openai-tts',
      name: 'OpenAI TTS',
      requiresApiKey: true,
      defaultBaseUrl: 'https://api.openai.com/v1',
    },
  },
  ASR_PROVIDERS: {
    'openai-whisper': {
      id: 'openai-whisper',
      name: 'OpenAI Whisper',
      requiresApiKey: true,
      defaultBaseUrl: 'https://api.openai.com/v1',
    },
  },
  getTTSVoices: () => [{ id: 'alloy', name: 'Alloy' }],
  getASRSupportedLanguages: () => ['zh-CN', 'en-US'],
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Azure voices JSON
vi.mock('@/lib/audio/azure.json', () => ({
  default: { voices: [] },
}));

describe('AudioSettings - Audio Storage Source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioStorageSource = 'indexeddb';
    mockStoreState = createMockState();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Rendering', () => {
    it('should render both storage source options', () => {
      render(<AudioSettings />);

      // Check for radio group options by their label text
      expect(screen.getByText(/本地存储 \(IndexedDB\)/i)).toBeDefined();
      expect(screen.getByText(/服务器存储/i)).toBeDefined();
    });

    it('should render storage source section title', () => {
      render(<AudioSettings />);

      expect(screen.getByText(/音频存储位置/i)).toBeDefined();
    });

    it('should render storage source descriptions', () => {
      render(<AudioSettings />);

      expect(screen.getByText(/选择音频文件的存储方式/i)).toBeDefined();
    });

    it('should render option descriptions', () => {
      render(<AudioSettings />);

      expect(screen.getByText(/音频保存在浏览器本地，适合离线使用/i)).toBeDefined();
      expect(screen.getByText(/音频保存在服务器，适合多设备同步/i)).toBeDefined();
    });
  });

  describe('Default Selection', () => {
    it('should default to IndexedDB selected', () => {
      render(<AudioSettings />);

      // Get all radio buttons by role
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBeGreaterThanOrEqual(2);

      // Find the indexeddb radio by its aria-checked attribute or data-value
      const indexeddbRadio = radios.find(r => r.getAttribute('data-value') === 'indexeddb' || r.getAttribute('value') === 'indexeddb');
      const serverRadio = radios.find(r => r.getAttribute('data-value') === 'server' || r.getAttribute('value') === 'server');

      expect(indexeddbRadio).toBeDefined();
      expect(serverRadio).toBeDefined();
      expect(indexeddbRadio?.getAttribute('aria-checked')).toBe('true');
      expect(serverRadio?.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('User Interaction', () => {
    it('should call setAudioStorageSource when switching to server storage', () => {
      render(<AudioSettings />);

      // Get all radio buttons and find the server one
      const radios = screen.getAllByRole('radio');
      const serverRadio = radios.find(r => r.getAttribute('data-value') === 'server' || r.getAttribute('value') === 'server');

      expect(serverRadio).toBeDefined();
      if (serverRadio) {
        fireEvent.click(serverRadio);
      }

      expect(mockSetAudioStorageSource).toHaveBeenCalledWith('server');
    });

    it('should call setAudioStorageSource when switching to indexeddb storage', () => {
      // Start with server storage
      mockAudioStorageSource = 'server';
      mockStoreState = createMockState({ audioStorageSource: 'server' });

      render(<AudioSettings />);

      // Get all radio buttons and find the indexeddb one
      const radios = screen.getAllByRole('radio');
      const indexeddbRadio = radios.find(r => r.getAttribute('data-value') === 'indexeddb' || r.getAttribute('value') === 'indexeddb');

      expect(indexeddbRadio).toBeDefined();
      if (indexeddbRadio) {
        fireEvent.click(indexeddbRadio);
      }

      expect(mockSetAudioStorageSource).toHaveBeenCalledWith('indexeddb');
    });
  });

  describe('Persistence', () => {
    it('should reflect the current value from the store', () => {
      // Mock store with server storage selected
      mockAudioStorageSource = 'server';
      mockStoreState = createMockState({ audioStorageSource: 'server' });

      render(<AudioSettings />);

      // Get all radio buttons
      const radios = screen.getAllByRole('radio');
      const indexeddbRadio = radios.find(r => r.getAttribute('data-value') === 'indexeddb' || r.getAttribute('value') === 'indexeddb');
      const serverRadio = radios.find(r => r.getAttribute('data-value') === 'server' || r.getAttribute('value') === 'server');

      expect(indexeddbRadio?.getAttribute('aria-checked')).toBe('false');
      expect(serverRadio?.getAttribute('aria-checked')).toBe('true');
    });
  });
});
