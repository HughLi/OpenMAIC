'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useStageStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import type { Scene, SlideContent } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { PPTLatexElement } from '@/lib/types/slides';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';

const log = createLogger('ExportVideoDirect');

interface VideoExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: number;
  slideDuration?: number;
}

interface VideoExportState {
  exporting: boolean;
  progress: number;
  currentSlide: number;
  totalSlides: number;
  status: string;
  speed?: number; // x times faster than realtime
}

// Check if WebCodecs API is supported
function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

export function useExportVideoDirect() {
  const { t } = useI18n();
  const scenes = useStageStore((s) => s.scenes);
  const [state, setState] = useState<VideoExportState>({
    exporting: false,
    progress: 0,
    currentSlide: 0,
    totalSlides: 0,
    status: '',
  });

  const abortRef = useRef(false);

  const exportVideo = useCallback(
    async (options: VideoExportOptions = {}) => {
      if (state.exporting) return;

      // Check WebCodecs support
      if (!isWebCodecsSupported()) {
        toast.error('您的浏览器不支持直接视频生成，请使用 Chrome/Edge 94+');
        return;
      }

      const {
        width = 1920,
        height = 1080,
        fps = 30,
        videoBitrate = 5000000,
        slideDuration = 3,
      } = options;

      // Filter slide scenes only
      const slideScenes = scenes.filter(
        (s): s is Scene & { content: SlideContent } =>
          s.content?.type === 'slide'
      );

      if (slideScenes.length === 0) {
        toast.error(t('export.noSlides'));
        return;
      }

      abortRef.current = false;
      const startTime = Date.now();

      setState({
        exporting: true,
        progress: 0,
        currentSlide: 0,
        totalSlides: slideScenes.length,
        status: t('export.preparingVideo'),
      });

      try {
        // Create canvas for rendering
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // Collect audio for each slide
        setState((s) => ({ ...s, status: '正在收集音频...' }));
        const slideAudios = await collectSlideAudios(slideScenes);

        // Calculate total duration
        const totalDuration = slideAudios.reduce(
          (sum, audio) => sum + (audio ? audio.duration : slideDuration),
          0
        );

        setState((s) => ({
          ...s,
          status: '正在生成视频...',
        }));

        // Generate video using WebCodecs + webm-muxer
        const webmBlob = await generateVideoDirect({
          canvas,
          ctx,
          scenes: slideScenes,
          slideAudios,
          slideDuration,
          fps,
          videoBitrate,
          width,
          height,
          onProgress: (progress, currentSlide, speed) => {
            setState((s) => ({
              ...s,
              progress,
              currentSlide,
              speed,
            }));
          },
          onStatusUpdate: (status) => {
            setState((s) => ({ ...s, status }));
          },
          abortRef,
        });

        if (abortRef.current) {
          toast.info(t('export.cancelled'));
          return;
        }

        // Download the WebM video
        const url = URL.createObjectURL(webmBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `openmaic-video-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        toast.success(`视频生成完成！用时 ${elapsed} 秒`);
      } catch (error) {
        log.error('Video export error:', error);
        toast.error(
          error instanceof Error ? error.message : t('export.videoError')
        );
      } finally {
        setState((s) => ({ ...s, exporting: false, status: '' }));
      }
    },
    [scenes, state.exporting, t]
  );

  const cancelExport = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    ...state,
    exportVideo,
    cancelExport,
    isSupported: isWebCodecsSupported(),
  };
}

interface GenerateVideoDirectParams {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scenes: Scene[];
  slideAudios: (AudioBuffer | null)[];
  slideDuration: number;
  fps: number;
  videoBitrate: number;
  width: number;
  height: number;
  onProgress: (progress: number, currentSlide: number, speed: number) => void;
  abortRef: { current: boolean };
  onStatusUpdate?: (status: string) => void;
}


async function generateVideoDirect(
  params: GenerateVideoDirectParams
): Promise<Blob> {
  const {
    canvas,
    ctx,
    scenes,
    slideAudios,
    slideDuration,
    fps,
    videoBitrate,
    width,
    height,
    onProgress,
    abortRef,
  } = params;

  // Use VP9 + WebM for best compatibility with ffmpeg conversion
  const encoderConfig: VideoEncoderConfig = {
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
    latencyMode: 'quality',
  };

  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) {
    throw new Error('Video encoding not supported, please use Chrome/Edge 94+');
  }

  // Create WebM muxer
  const arrayBufferTarget = new WebMArrayBufferTarget();
  const muxer = new WebMMuxer({
    target: arrayBufferTarget,
    video: {
      codec: 'V_VP9',
      width,
      height,
      frameRate: fps,
    },
    audio: {
      codec: 'A_OPUS',
      sampleRate: 48000,
      numberOfChannels: 2,
    },
    firstTimestampBehavior: 'offset',
  });

  // Setup video encoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      throw new Error(`Video encoding error: ${e.message}`);
    },
  });

  videoEncoder.configure(encoderConfig);

  // Setup audio encoder if we have audio
  let audioEncoder: AudioEncoder | null = null;
  const hasAudio = slideAudios.some((a) => a !== null);

  if (hasAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (e) => {
        log.error(`Audio encoding error: ${e.message}`);
        // Don't throw - audio encoding failure shouldn't stop video generation
      },
    });

    const audioConfig: AudioEncoderConfig = {
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
    };

    const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
    if (audioSupport.supported) {
      try {
        audioEncoder.configure(audioConfig);
      } catch (e) {
        log.error('Failed to configure audio encoder:', e);
        audioEncoder = null;
      }
    } else {
      log.warn('Audio codec not supported');
      audioEncoder = null;
    }
  }

  const startTime = Date.now();
  let frameCount = 0;
  const frameDuration = 1000000 / fps; // microseconds

  // Process each scene
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    if (abortRef.current) break;

    const scene = scenes[sceneIndex];
    const audio = slideAudios[sceneIndex];
    const durationSeconds = audio ? audio.duration : slideDuration;
    const sceneFrameCount = Math.ceil(durationSeconds * fps);
    const baseTimestamp = frameCount * frameDuration;

    // Render scene once (before encoding frames)
    await renderSlideToCanvas(ctx, canvas, scene);

    // Encode all frames for this scene at maximum speed (no waiting)
    for (let i = 0; i < sceneFrameCount; i++) {
      if (abortRef.current) break;

      const timestamp = baseTimestamp + i * frameDuration;

      const videoFrame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDuration,
      });

      const keyFrame = i === 0;
      videoEncoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      frameCount++;
    }

    // Process audio for this scene
    if (audio && audioEncoder && audioEncoder.state === 'configured') {
      try {
        await encodeAudioBuffer(audio, audioEncoder, baseTimestamp);
      } catch (e) {
        log.error('Failed to encode audio for scene:', sceneIndex, e);
      }
    }

    // Calculate speed
    const elapsed = (Date.now() - startTime) / 1000;
    const processedDuration = slideAudios
      .slice(0, sceneIndex + 1)
      .reduce((sum, a) => sum + (a ? a.duration : slideDuration), 0);
    const speed = elapsed > 0 ? processedDuration / elapsed : 0;

    const progress = Math.floor(((sceneIndex + 1) / scenes.length) * 100);
    onProgress(progress, sceneIndex + 1, speed);

    // Yield occasionally to prevent blocking
    if (sceneIndex % 3 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Finish encoding
  try {
    await videoEncoder.flush();
    videoEncoder.close();
  } catch (e) {
    log.error('Failed to flush/close video encoder:', e);
    throw e;
  }

  if (audioEncoder && audioEncoder.state !== 'closed') {
    try {
      await audioEncoder.flush();
      audioEncoder.close();
    } catch (e) {
      log.error('Failed to flush/close audio encoder:', e);
    }
  }

  if (abortRef.current) {
    throw new Error('Export cancelled');
  }

  // Finalize muxer
  await muxer.finalize();

  // Get WebM buffer and create blob
  const webmBuffer = arrayBufferTarget.buffer;
  return new Blob([webmBuffer], { type: 'video/webm' });
}

// Target audio parameters for encoding
const TARGET_SAMPLE_RATE = 48000;
const TARGET_CHANNELS = 2;

async function encodeAudioBuffer(
  audioBuffer: AudioBuffer,
  encoder: AudioEncoder,
  baseTimestamp: number
): Promise<void> {
  // Check if encoder is still open
  if (encoder.state === 'closed') {
    log.warn('AudioEncoder is closed, skipping audio encoding');
    return;
  }

  try {
    // Resample audio to match encoder configuration
    const resampledBuffer = await resampleAudioBuffer(audioBuffer);

    const numberOfChannels = resampledBuffer.numberOfChannels;
    const sampleRate = resampledBuffer.sampleRate;
    const length = resampledBuffer.length;

    // Use non-planar format for better compatibility
    const interleavedData = interleaveAudioBuffer(resampledBuffer);

    // Convert Float32Array to ArrayBuffer
    const arrayBuffer = interleavedData.buffer as ArrayBuffer;

    // Convert AudioBuffer to AudioData format
    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: length,
      numberOfChannels,
      timestamp: baseTimestamp,
      data: arrayBuffer,
    });

    if (encoder.state === 'configured') {
      encoder.encode(audioData);
    }
    audioData.close();
  } catch (error) {
    log.error('Failed to encode audio buffer:', error);
    // Don't throw, just skip this audio segment
  }
}

// Resample audio buffer to target sample rate and channel count
async function resampleAudioBuffer(
  sourceBuffer: AudioBuffer
): Promise<AudioBuffer> {
  const sourceRate = sourceBuffer.sampleRate;
  const sourceChannels = sourceBuffer.numberOfChannels;
  const sourceLength = sourceBuffer.length;

  // If already matches target, return as-is
  if (sourceRate === TARGET_SAMPLE_RATE && sourceChannels === TARGET_CHANNELS) {
    return sourceBuffer;
  }

  // Create offline audio context for resampling
  const offlineCtx = new OfflineAudioContext(
    TARGET_CHANNELS,
    Math.ceil((sourceLength * TARGET_SAMPLE_RATE) / sourceRate),
    TARGET_SAMPLE_RATE
  );

  // Create buffer source
  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;

  // Handle channel conversion if needed
  if (sourceChannels === 1) {
    // Mono to stereo: duplicate channel
    const merger = offlineCtx.createChannelMerger(2);
    const splitter = offlineCtx.createChannelSplitter(1);

    source.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 0, 1);
    merger.connect(offlineCtx.destination);
  } else {
    // Stereo or more channels, just connect directly
    source.connect(offlineCtx.destination);
  }

  // Render
  source.start(0);
  return await offlineCtx.startRendering();
}

function interleaveAudioBuffer(buffer: AudioBuffer): Float32Array {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const result = new Float32Array(length * numberOfChannels);

  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      result[i * numberOfChannels + ch] = buffer.getChannelData(ch)[i];
    }
  }

  return result;
}

// Collect audio for each slide
async function collectSlideAudios(
  scenes: Scene[]
): Promise<(AudioBuffer | null)[]> {
  const audioContext = new AudioContext();
  const audios: (AudioBuffer | null)[] = [];

  for (const scene of scenes) {
    const audioBuffer = await getSceneAudio(scene, audioContext);
    audios.push(audioBuffer);
  }

  await audioContext.close();
  return audios;
}

// Get audio for a scene
async function getSceneAudio(
  scene: Scene,
  audioContext: AudioContext
): Promise<AudioBuffer | null> {
  // Check scene content audio
  const contentWithAudio = scene.content as unknown as {
    audio?: { id: string };
  };
  if (contentWithAudio?.audio?.id) {
    const audio = await loadAudioFromIndexedDB(contentWithAudio.audio.id);
    if (audio) {
      const arrayBuffer = await audio.arrayBuffer();
      try {
        return await audioContext.decodeAudioData(arrayBuffer);
      } catch {
        // Ignore decode errors
      }
    }
  }

  // Check speech actions
  const speechActions = scene.actions?.filter(
    (a): a is SpeechAction => a.type === 'speech'
  );

  if (speechActions && speechActions.length > 0) {
    const buffers: AudioBuffer[] = [];
    for (const action of speechActions) {
      if (action.audioId) {
        const audio = await loadAudioFromIndexedDB(action.audioId);
        if (audio) {
          const arrayBuffer = await audio.arrayBuffer();
          try {
            const decoded = await audioContext.decodeAudioData(arrayBuffer);
            buffers.push(decoded);
          } catch {
            // Ignore decode errors
          }
        }
      }
    }

    if (buffers.length > 0) {
      return concatenateAudioBuffers(buffers, audioContext);
    }
  }

  return null;
}

// Load audio from IndexedDB
async function loadAudioFromIndexedDB(audioId: string): Promise<Blob | null> {
  try {
    const { db } = await import('@/lib/utils/database');
    const audio = await db.audioFiles.get(audioId);
    return audio?.blob || null;
  } catch (error) {
    log.error('Failed to load audio:', error);
    return null;
  }
}

// Concatenate multiple audio buffers
function concatenateAudioBuffers(
  buffers: AudioBuffer[],
  audioContext: AudioContext
): AudioBuffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const numberOfChannels = Math.max(
    ...buffers.map((buf) => buf.numberOfChannels)
  );
  const sampleRate = buffers[0]?.sampleRate || 44100;

  const result = audioContext.createBuffer(
    numberOfChannels,
    totalLength,
    sampleRate
  );

  let offset = 0;
  for (const buffer of buffers) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const resultChannel = result.getChannelData(channel);
      const bufferChannel = buffer.getChannelData(
        Math.min(channel, buffer.numberOfChannels - 1)
      );
      resultChannel.set(bufferChannel, offset);
    }
    offset += buffer.length;
  }

  return result;
}

// Render a slide to canvas
async function renderSlideToCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: Scene
): Promise<void> {
  // Clear canvas
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (scene.content?.type !== 'slide') return;

  const slide = scene.content.canvas;
  if (!slide) return;

  // Calculate scale to fit slide in canvas
  const slideWidth = 1280;
  const slideHeight = 720;
  const scaleX = canvas.width / slideWidth;
  const scaleY = canvas.height / slideHeight;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (canvas.width - slideWidth * scale) / 2;
  const offsetY = (canvas.height - slideHeight * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Render background
  if (slide.background) {
    ctx.fillStyle = slide.background.color || '#ffffff';
    ctx.fillRect(0, 0, 1280, 720);
  }

  // Render elements
  if (slide.elements) {
    for (const element of slide.elements) {
      await renderElement(ctx, element);
    }
  }

  ctx.restore();
}

// Render individual element
async function renderElement(
  ctx: CanvasRenderingContext2D,
  element: unknown
): Promise<void> {
  // PPT elements use 'left'/'top' instead of 'x'/'y'
  const pptEl = element as {
    type: string;
    left: number;
    top: number;
    width: number;
    height: number;
    content?: string;
    src?: string;
    style?: Record<string, unknown>;
  };

  // Normalize to x/y for rendering
  const el = {
    ...pptEl,
    x: pptEl.left,
    y: pptEl.top,
  };

  switch (el.type) {
    case 'text':
      renderTextElement(ctx, el);
      break;
    case 'image':
      await renderImageElement(ctx, el);
      break;
    case 'shape':
      renderShapeElement(ctx, el);
      break;
    case 'latex':
      await renderLatexElement(ctx, element as unknown as PPTLatexElement);
      break;
    case 'line':
      renderLineElement(ctx, el);
      break;
    case 'chart':
      renderChartPlaceholder(ctx, el);
      break;
    case 'table':
      renderTablePlaceholder(ctx, el);
      break;
    case 'video':
      renderVideoPlaceholder(ctx, el);
      break;
    case 'audio':
      renderAudioPlaceholder(ctx, el);
      break;
    default:
      log.warn('Unknown element type:', el.type);
  }
}

// Parse color value to CSS color string
function parseColor(color: unknown): string {
  if (!color) return '#000000';
  if (typeof color === 'string') return color;
  // Handle color object format if needed
  return '#000000';
}

// Extract styles from HTML element
function extractElementStyles(element: HTMLElement): {
  fontSize: number | null;
  fontFamily: string | null;
  color: string | null;
  fontWeight: string | null;
  fontStyle: string | null;
  textDecoration: string | null;
} {
  const style = element.style;

  // Parse font size
  let fontSize: number | null = null;
  const fontSizeStr = style.fontSize;
  if (fontSizeStr) {
    const match = fontSizeStr.match(/(\d+)/);
    if (match) fontSize = parseInt(match[1], 10);
  }

  // Parse color
  let color: string | null = style.color;
  if (!color && element.getAttribute('color')) {
    color = element.getAttribute('color');
  }

  // Parse font family
  const fontFamily = style.fontFamily || element.getAttribute('face') || null;

  // Parse font weight
  const fontWeight = style.fontWeight || (element.tagName === 'B' || element.tagName === 'STRONG' ? 'bold' : null);

  // Parse font style
  const fontStyle = style.fontStyle || (element.tagName === 'I' || element.tagName === 'EM' ? 'italic' : null);

  // Parse text decoration
  let textDecoration = style.textDecoration;
  if (element.tagName === 'U') textDecoration = 'underline';
  if (element.tagName === 'S' || element.tagName === 'STRIKE' || element.tagName === 'DEL') textDecoration = 'line-through';

  return {
    fontSize,
    fontFamily: fontFamily ? fontFamily.replace(/['"]/g, '') : null,
    color,
    fontWeight,
    fontStyle,
    textDecoration,
  };
}

// Text run with styles
interface TextRun {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}

// Parse HTML content into text runs with styles
function parseHtmlContent(html: string, defaultFontSize: number, defaultFontFamily: string, defaultColor: string): TextRun[] {
  if (!html) return [];

  const runs: TextRun[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function processNode(node: Node, inheritedStyles: Partial<TextRun> = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text.trim() || text.includes(' ')) {
        runs.push({
          text,
          fontSize: inheritedStyles.fontSize,
          fontFamily: inheritedStyles.fontFamily,
          color: inheritedStyles.color,
          fontWeight: inheritedStyles.fontWeight,
          fontStyle: inheritedStyles.fontStyle,
          textDecoration: inheritedStyles.textDecoration,
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const styles = extractElementStyles(element);

      // Merge inherited styles with current element styles
      const mergedStyles: Partial<TextRun> = {
        fontSize: styles.fontSize || inheritedStyles.fontSize,
        fontFamily: styles.fontFamily || inheritedStyles.fontFamily,
        color: styles.color || inheritedStyles.color,
        fontWeight: styles.fontWeight || inheritedStyles.fontWeight,
        fontStyle: styles.fontStyle || inheritedStyles.fontStyle,
        textDecoration: styles.textDecoration || inheritedStyles.textDecoration,
      };

      // Handle line breaks for block elements
      if ((element.tagName === 'P' || element.tagName === 'DIV') && runs.length > 0) {
        const lastRun = runs[runs.length - 1];
        if (!lastRun.text.endsWith('\n')) {
          lastRun.text += '\n';
        }
      }

      // Process children
      for (const child of Array.from(element.childNodes)) {
        processNode(child, mergedStyles);
      }

      // Add newline after block elements
      if ((element.tagName === 'P' || element.tagName === 'DIV' || element.tagName === 'BR') && runs.length > 0) {
        const lastRun = runs[runs.length - 1];
        if (!lastRun.text.endsWith('\n')) {
          lastRun.text += '\n';
        }
      }
    }
  }

  for (const child of Array.from(doc.body.childNodes)) {
    processNode(child, {
      fontSize: defaultFontSize,
      fontFamily: defaultFontFamily,
      color: defaultColor,
    });
  }

  // If no runs were created, try to get plain text as fallback
  if (runs.length === 0) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || '';
    if (text.trim()) {
      return [{ text: text.trim(), fontSize: defaultFontSize, fontFamily: defaultFontFamily, color: defaultColor }];
    }
  }

  return runs;
}

function renderTextElement(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
    content?: string;
    // PPT element properties (not nested in style)
    defaultFontName?: string;
    defaultColor?: string;
    fontSize?: number;
    lineHeight?: number;
    textAlign?: 'left' | 'center' | 'right';
    style?: Record<string, unknown>;
  }
): void {
  ctx.save();

  // Get base styles from PPT element properties
  const baseFontSize = el.fontSize || 16;
  const baseFontFamily = el.defaultFontName || 'Arial';
  const baseColor = parseColor(el.defaultColor) || '#000000';
  const align = el.textAlign || (el.style?.textAlign as string) || 'left';

  // Map text align to canvas text align
  const canvasAlign: CanvasTextAlign =
    align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  ctx.textAlign = canvasAlign;
  ctx.textBaseline = 'top';

  // Calculate line height
  const lineHeightValue = el.lineHeight || 1.5;

  // Parse HTML content into text runs with styles
  const textRuns = parseHtmlContent(el.content || '', baseFontSize, baseFontFamily, baseColor);

  if (textRuns.length === 0) {
    ctx.restore();
    return;
  }

  // Layout text runs into lines that fit within width
  const lines: { runs: TextRun[]; height: number }[] = [];
  let currentLine: TextRun[] = [];
  let currentLineWidth = 0;
  let currentLineHeight = baseFontSize * lineHeightValue;

  // Helper to get font string for a run
  const getFont = (run: TextRun): string => {
    const size = run.fontSize || baseFontSize;
    const family = run.fontFamily || baseFontFamily;
    const weight = run.fontWeight || 'normal';
    const style = run.fontStyle || 'normal';

    if (style === 'italic') {
      return `italic ${weight} ${size}px ${family}`;
    }
    if (weight === 'bold') {
      return `bold ${size}px ${family}`;
    }
    return `${size}px ${family}`;
  };

  // Helper to measure text width
  const measureText = (run: TextRun): number => {
    ctx.font = getFont(run);
    return ctx.measureText(run.text).width;
  };

  // Process text runs into lines
  for (const run of textRuns) {
    const fontSize = run.fontSize || baseFontSize;
    const runLineHeight = fontSize * lineHeightValue;
    currentLineHeight = Math.max(currentLineHeight, runLineHeight);

    // Handle explicit newlines in the text
    const parts = run.text.split('\n');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // If this is a subsequent part after a newline, finish the current line first
      if (i > 0 && currentLine.length > 0) {
        lines.push({ runs: currentLine, height: currentLineHeight });
        currentLine = [];
        currentLineWidth = 0;
        currentLineHeight = baseFontSize * lineHeightValue;
      }

      if (part === '') continue;

      // Check if this part fits in the current line
      const partRun = { ...run, text: part };
      const partWidth = measureText(partRun);

      // Word wrapping - if adding this part exceeds width, start a new line
      // Only wrap if current line has content and this is a substantial word
      if (currentLine.length > 0 && currentLineWidth + partWidth > el.width) {
        // Find a good break point
        ctx.font = getFont(partRun);
        const words = part.split(/(\s+)/);
        let currentPart = '';
        let remainingPart = '';
        let foundBreak = false;

        for (const word of words) {
          const testPart = currentPart + word;
          const testWidth = ctx.measureText(testPart).width;

          if (currentLineWidth + testWidth <= el.width || currentPart === '') {
            currentPart = testPart;
          } else {
            remainingPart = words.slice(words.indexOf(word)).join('');
            foundBreak = true;
            break;
          }
        }

        if (currentPart) {
          currentLine.push({ ...partRun, text: currentPart });
        }

        if (foundBreak || remainingPart) {
          // Finish current line
          lines.push({ runs: currentLine, height: currentLineHeight });

          // Start new line with remaining part
          if (remainingPart.trim()) {
            currentLine = [{ ...partRun, text: remainingPart }];
            currentLineWidth = measureText({ ...partRun, text: remainingPart });
          } else {
            currentLine = [];
            currentLineWidth = 0;
          }
          currentLineHeight = baseFontSize * lineHeightValue;
        } else {
          currentLineWidth += ctx.measureText(currentPart).width;
        }
      } else {
        currentLine.push(partRun);
        currentLineWidth += partWidth;
      }
    }
  }

  // Push final line
  if (currentLine.length > 0) {
    lines.push({ runs: currentLine, height: currentLineHeight });
  }

  // Render lines
  let y = el.y;

  for (const line of lines) {
    // Calculate starting x based on alignment
    let x: number;
    if (canvasAlign === 'center') {
      const lineWidth = line.runs.reduce((sum, run) => {
        ctx.font = getFont(run);
        return sum + ctx.measureText(run.text).width;
      }, 0);
      x = el.x + el.width / 2;
    } else if (canvasAlign === 'right') {
      x = el.x + el.width;
    } else {
      x = el.x;
    }

    let currentX = x;

    // For left alignment, accumulate width from left
    if (canvasAlign === 'left') {
      for (const run of line.runs) {
        ctx.font = getFont(run);
        ctx.fillStyle = run.color || baseColor;

        // Handle text decoration
        if (run.textDecoration === 'underline') {
          const metrics = ctx.measureText(run.text);
          const lineY = y + (run.fontSize || baseFontSize) * 0.9;
          ctx.beginPath();
          ctx.moveTo(currentX, lineY);
          ctx.lineTo(currentX + metrics.width, lineY);
          ctx.strokeStyle = run.color || baseColor;
          ctx.lineWidth = Math.max(1, (run.fontSize || baseFontSize) / 20);
          ctx.stroke();
        }

        ctx.fillText(run.text, currentX, y);
        currentX += ctx.measureText(run.text).width;
      }
    } else if (canvasAlign === 'center') {
      // For center alignment, first measure total width
      const totalWidth = line.runs.reduce((sum, run) => {
        ctx.font = getFont(run);
        return sum + ctx.measureText(run.text).width;
      }, 0);
      currentX = x - totalWidth / 2;

      for (const run of line.runs) {
        ctx.font = getFont(run);
        ctx.fillStyle = run.color || baseColor;

        // Handle text decoration
        if (run.textDecoration === 'underline') {
          const metrics = ctx.measureText(run.text);
          const lineY = y + (run.fontSize || baseFontSize) * 0.9;
          ctx.beginPath();
          ctx.moveTo(currentX, lineY);
          ctx.lineTo(currentX + metrics.width, lineY);
          ctx.strokeStyle = run.color || baseColor;
          ctx.lineWidth = Math.max(1, (run.fontSize || baseFontSize) / 20);
          ctx.stroke();
        }

        ctx.fillText(run.text, currentX, y);
        currentX += ctx.measureText(run.text).width;
      }
    } else {
      // For right alignment, measure from right
      const totalWidth = line.runs.reduce((sum, run) => {
        ctx.font = getFont(run);
        return sum + ctx.measureText(run.text).width;
      }, 0);
      currentX = x - totalWidth;

      for (const run of line.runs) {
        ctx.font = getFont(run);
        ctx.fillStyle = run.color || baseColor;

        // Handle text decoration
        if (run.textDecoration === 'underline') {
          const metrics = ctx.measureText(run.text);
          const lineY = y + (run.fontSize || baseFontSize) * 0.9;
          ctx.beginPath();
          ctx.moveTo(currentX, lineY);
          ctx.lineTo(currentX + metrics.width, lineY);
          ctx.strokeStyle = run.color || baseColor;
          ctx.lineWidth = Math.max(1, (run.fontSize || baseFontSize) / 20);
          ctx.stroke();
        }

        ctx.fillText(run.text, currentX, y);
        currentX += ctx.measureText(run.text).width;
      }
    }

    y += line.height;

    // Stop if we've exceeded the element height
    if (y > el.y + el.height) {
      break;
    }
  }

  ctx.restore();
}

// Render image element
async function renderImageElement(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
    src?: string;
    style?: Record<string, unknown>;
  }
): Promise<void> {
  if (!el.src) return;

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
      img.src = el.src!;
    });

    ctx.drawImage(img, el.x, el.y, el.width, el.height);
  } catch {
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(el.x, el.y, el.width, el.height);
    ctx.fillStyle = '#999999';
    ctx.fillText('Image', el.x + 10, el.y + 20);
  }
}

// Render shape element
function renderShapeElement(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
    outline?: { color?: string; width?: number; style?: string };
    style?: Record<string, unknown>;
  }
): void {
  ctx.save();

  // PPT shape uses 'fill' for background, 'outline' for border
  ctx.fillStyle = parseColor(el.fill) || (el.style?.backgroundColor as string) || '#cccccc';

  if (el.outline) {
    ctx.strokeStyle = parseColor(el.outline.color) || (el.style?.borderColor as string) || '#000000';
    ctx.lineWidth = el.outline.width || (el.style?.borderWidth as number) || 1;
  } else {
    ctx.strokeStyle = (el.style?.borderColor as string) || '#000000';
    ctx.lineWidth = (el.style?.borderWidth as number) || 1;
  }

  ctx.beginPath();
  ctx.rect(el.x, el.y, el.width, el.height);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// Render line element
function renderLineElement(
  ctx: CanvasRenderingContext2D,
  element: unknown
): void {
  const el = element as {
    left: number;
    top: number;
    start?: [number, number];
    end?: [number, number];
    color?: string;
    style?: Record<string, unknown>;
  };

  ctx.save();

  // PPT line uses 'color' directly, or style.color
  ctx.strokeStyle = parseColor(el.color) || (el.style?.color as string) || '#000000';
  ctx.lineWidth = (el.style?.width as number) || 2;
  ctx.lineCap = 'round';

  ctx.beginPath();

  // Use start/end if available, otherwise fall back to left/top
  if (el.start && el.end) {
    ctx.moveTo(el.start[0], el.start[1]);
    ctx.lineTo(el.end[0], el.end[1]);
  } else {
    // Fallback for simple lines using left/top
    ctx.moveTo(el.left, el.top);
    ctx.lineTo(el.left + ((el.style?.width as number) || 100), el.top);
  }

  ctx.stroke();

  ctx.restore();
}

// Render chart placeholder
function renderChartPlaceholder(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): void {
  ctx.save();

  // Draw placeholder box
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(el.x, el.y, el.width, el.height);
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.strokeRect(el.x, el.y, el.width, el.height);

  // Draw chart icon
  ctx.fillStyle = '#999999';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('[Chart]', el.x + el.width / 2, el.y + el.height / 2);

  ctx.restore();
}

// Render table placeholder
function renderTablePlaceholder(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): void {
  ctx.save();

  // Draw placeholder box
  ctx.fillStyle = '#f9f9f9';
  ctx.fillRect(el.x, el.y, el.width, el.height);
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.strokeRect(el.x, el.y, el.width, el.height);

  // Draw grid lines
  ctx.strokeStyle = '#dddddd';
  const rows = 4;
  const cols = 3;
  const cellHeight = el.height / rows;
  const cellWidth = el.width / cols;

  for (let i = 1; i < rows; i++) {
    ctx.beginPath();
    ctx.moveTo(el.x, el.y + i * cellHeight);
    ctx.lineTo(el.x + el.width, el.y + i * cellHeight);
    ctx.stroke();
  }

  for (let i = 1; i < cols; i++) {
    ctx.beginPath();
    ctx.moveTo(el.x + i * cellWidth, el.y);
    ctx.lineTo(el.x + i * cellWidth, el.y + el.height);
    ctx.stroke();
  }

  // Draw label
  ctx.fillStyle = '#999999';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('[Table]', el.x + el.width / 2, el.y + el.height / 2);

  ctx.restore();
}

// Render video placeholder
function renderVideoPlaceholder(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): void {
  ctx.save();

  // Draw placeholder box
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(el.x, el.y, el.width, el.height);

  // Draw play button triangle
  const centerX = el.x + el.width / 2;
  const centerY = el.y + el.height / 2;
  const size = Math.min(el.width, el.height) * 0.2;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(centerX - size * 0.3, centerY - size);
  ctx.lineTo(centerX - size * 0.3, centerY + size);
  ctx.lineTo(centerX + size * 0.7, centerY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Render audio placeholder
function renderAudioPlaceholder(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): void {
  ctx.save();

  // Draw placeholder box
  ctx.fillStyle = '#e8f4f8';
  ctx.fillRect(el.x, el.y, el.width, el.height);
  ctx.strokeStyle = '#99ccdd';
  ctx.lineWidth = 1;
  ctx.strokeRect(el.x, el.y, el.width, el.height);

  // Draw audio icon (sound waves)
  ctx.strokeStyle = '#6699aa';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const centerX = el.x + el.width / 2;
  const centerY = el.y + el.height / 2;

  // Draw speaker icon
  ctx.fillStyle = '#6699aa';
  ctx.beginPath();
  ctx.moveTo(centerX - 10, centerY - 5);
  ctx.lineTo(centerX - 5, centerY - 5);
  ctx.lineTo(centerX + 5, centerY - 10);
  ctx.lineTo(centerX + 5, centerY + 10);
  ctx.lineTo(centerX - 5, centerY + 5);
  ctx.lineTo(centerX - 10, centerY + 5);
  ctx.closePath();
  ctx.fill();

  // Draw sound waves
  ctx.beginPath();
  ctx.arc(centerX + 8, centerY, 5, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX + 8, centerY, 9, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();

  ctx.restore();
}

// Render LaTeX element
async function renderLatexElement(
  ctx: CanvasRenderingContext2D,
  el: PPTLatexElement
): Promise<void> {
  ctx.save();

  // PPTLatexElement uses 'left' and 'top' instead of 'x' and 'y'
  const x = el.left;
  const y = el.top;
  const { width, height, path, viewBox, color, strokeWidth, latex, html } = el;

  // If we have SVG path data, render it
  if (path && viewBox) {
    const scaleX = width / viewBox[0];
    const scaleY = height / viewBox[1];

    ctx.strokeStyle = color || '#000000';
    ctx.lineWidth = strokeWidth || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'none';

    // Create a new Path2D from SVG path
    const path2d = new Path2D(path);

    // Apply transform to position and scale the path
    ctx.translate(x, y);
    ctx.scale(scaleX, scaleY);
    ctx.stroke(path2d);
  } else if (html) {
    // Fallback: if we have HTML but no path, try to render a placeholder
    // In a more advanced implementation, we could use html2canvas here
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#666666';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('[Formula]', x + width / 2, y + height / 2);

    // Also try to render the raw LaTeX if available
    if (latex) {
      ctx.font = '10px Arial';
      ctx.fillText(latex.substring(0, 30) + (latex.length > 30 ? '...' : ''), x + width / 2, y + height / 2 + 15);
    }
  } else if (latex) {
    // Last resort: just show the LaTeX code
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#333333';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Wrap text to fit within bounds
    const maxWidth = width - 10;
    const lineHeight = 14;
    const words = latex.split(' ');
    let line = '';
    let currentY = y + 5;

    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line, x + 5, currentY);
        line = word + ' ';
        currentY += lineHeight;
        if (currentY > y + height - lineHeight) break;
      } else {
        line = testLine;
      }
    }
    if (line && currentY <= y + height - lineHeight) {
      ctx.fillText(line, x + 5, currentY);
    }
  }

  ctx.restore();
}
