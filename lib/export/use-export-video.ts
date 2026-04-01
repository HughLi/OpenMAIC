'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useStageStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import type { Scene, SlideContent } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';

const log = createLogger('ExportVideo');

interface VideoExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: number;
  slideDuration?: number; // seconds per slide without audio
}

interface VideoExportState {
  exporting: boolean;
  progress: number;
  currentSlide: number;
  totalSlides: number;
  status: string;
}

export function useExportVideo() {
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
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // Get audio for each slide
        const slideAudios = await collectSlideAudios(slideScenes);

        setState((s) => ({ ...s, status: t('export.recordingVideo') }));

        // Setup MediaRecorder
        const stream = canvas.captureStream(fps);

        // Add audio tracks
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();

        // Combine all audio buffers
        const combinedAudioBuffer = await combineAudioBuffers(
          slideAudios,
          slideDuration,
          audioContext
        );

        const source = audioContext.createBufferSource();
        source.buffer = combinedAudioBuffer;
        source.connect(destination);
        source.connect(audioContext.destination);

        // Add audio track to video stream
        destination.stream.getAudioTracks().forEach((track) => {
          stream.addTrack(track);
        });

        // Setup recorder
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9,opus',
          videoBitsPerSecond: videoBitrate,
        });

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        const videoBlob = await new Promise<Blob>((resolve, reject) => {
          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            resolve(blob);
          };
          mediaRecorder.onerror = () => {
            reject(new Error('MediaRecorder error'));
          };

          mediaRecorder.start(100);

          // Start recording sequence
          recordSlides(
            ctx,
            canvas,
            slideScenes,
            slideAudios,
            slideDuration,
            fps,
            (progress, currentSlide) => {
              setState((s) => ({
                ...s,
                progress,
                currentSlide,
                status: `正在录制幻灯片 ${currentSlide}/${slideScenes.length}`,
              }));
            },
            abortRef
          ).then(() => {
            mediaRecorder.stop();
            stream.getTracks().forEach((track) => track.stop());
          });
        });

        if (abortRef.current) {
          toast.info(t('export.cancelled'));
          return;
        }

        // Download the video
        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `openmaic-video-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success(t('export.videoSuccess'));
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
  };
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

  return audios;
}

// Get audio for a scene
async function getSceneAudio(
  scene: Scene,
  audioContext: AudioContext
): Promise<AudioBuffer | null> {
  // Check scene content audio (using type assertion for legacy data)
  const contentWithAudio = scene.content as unknown as { audio?: { id: string } };
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
      // Concatenate all audio buffers
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
  const numberOfChannels = Math.max(...buffers.map((buf) => buf.numberOfChannels));
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
      const bufferChannel = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
      resultChannel.set(bufferChannel, offset);
    }
    offset += buffer.length;
  }

  return result;
}

// Combine all audio buffers with proper timing
async function combineAudioBuffers(
  slideAudios: (AudioBuffer | null)[],
  slideDuration: number,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const defaultDuration = slideDuration * sampleRate;

  // Calculate total duration
  const totalSamples = slideAudios.reduce((sum, audio) => {
    return sum + (audio ? audio.length : defaultDuration);
  }, 0);

  const result = audioContext.createBuffer(2, totalSamples, sampleRate);
  const leftChannel = result.getChannelData(0);
  const rightChannel = result.getChannelData(1);

  let offset = 0;
  for (const audio of slideAudios) {
    if (audio) {
      const duration = audio.length;
      const channels = audio.numberOfChannels;

      for (let i = 0; i < duration; i++) {
        const sample = audio.getChannelData(0)[i];
        leftChannel[offset + i] = sample;
        rightChannel[offset + i] =
          channels > 1 ? audio.getChannelData(1)[i] : sample;
      }
      offset += duration;
    } else {
      // Silent for default duration
      offset += defaultDuration;
    }
  }

  return result;
}

// Record slides to canvas
async function recordSlides(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scenes: Scene[],
  slideAudios: (AudioBuffer | null)[],
  slideDuration: number,
  fps: number,
  onProgress: (progress: number, currentSlide: number) => void,
  abortRef: { current: boolean }
): Promise<void> {
  const frameDuration = 1000 / fps;
  const sampleRate = 44100;
  const defaultDurationSamples = slideDuration * sampleRate;

  for (let i = 0; i < scenes.length; i++) {
    if (abortRef.current) return;

    const scene = scenes[i];
    const audio = slideAudios[i];
    const durationMs = audio
      ? (audio.length / sampleRate) * 1000
      : slideDuration * 1000;

    // Render slide
    await renderSlideToCanvas(ctx, canvas, scene);

    // Record frames for this slide
    const frames = Math.floor(durationMs / frameDuration);
    for (let frame = 0; frame < frames; frame++) {
      if (abortRef.current) return;
      await new Promise((resolve) => setTimeout(resolve, frameDuration));
    }

    const progress = Math.floor(((i + 1) / scenes.length) * 100);
    onProgress(progress, i + 1);
  }
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
  const slideWidth = 1280; // Default slide width
  const slideHeight = 720; // Default slide height
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
  const el = element as {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    content?: string;
    src?: string;
    style?: Record<string, unknown>;
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
    default:
      log.warn('Unknown element type:', el.type);
  }
}

// Render text element
function renderTextElement(
  ctx: CanvasRenderingContext2D,
  el: {
    x: number;
    y: number;
    width: number;
    height: number;
    content?: string;
    style?: Record<string, unknown>;
  }
): void {
  ctx.save();
  ctx.font = `${(el.style?.fontSize as number) || 16}px ${(el.style?.fontFamily as string) || 'Arial'}`;
  ctx.fillStyle = (el.style?.color as string) || '#000000';
  ctx.textAlign = (el.style?.textAlign as CanvasTextAlign) || 'left';
  ctx.textBaseline = 'top';

  const lines = (el.content || '').split('\n');
  const lineHeight = ((el.style?.fontSize as number) || 16) * 1.2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], el.x, el.y + i * lineHeight);
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
    // Draw placeholder
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
    style?: Record<string, unknown>;
  }
): void {
  ctx.save();
  ctx.fillStyle = (el.style?.backgroundColor as string) || '#cccccc';
  ctx.strokeStyle = (el.style?.borderColor as string) || '#000000';
  ctx.lineWidth = (el.style?.borderWidth as number) || 1;

  ctx.beginPath();
  ctx.rect(el.x, el.y, el.width, el.height);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
