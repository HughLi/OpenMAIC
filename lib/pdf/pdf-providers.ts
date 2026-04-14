/**
 * PDF Parsing Provider Implementation
 *
 * Factory pattern for routing PDF parsing requests to appropriate provider implementations.
 * Follows the same architecture as lib/ai/providers.ts for consistency.
 *
 * Currently Supported Providers:
 * - unpdf: Built-in Node.js PDF parser with text and image extraction
 * - MinerU: Advanced commercial service with OCR, formula, and table extraction
 *   (https://mineru.ai or self-hosted)
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * 1. Add provider ID to PDFProviderId in lib/pdf/types.ts
 *    Example: | 'tesseract-ocr'
 *
 * 2. Add provider configuration to lib/pdf/constants.ts
 *    Example:
 *    'tesseract-ocr': {
 *      id: 'tesseract-ocr',
 *      name: 'Tesseract OCR',
 *      requiresApiKey: false,
 *      icon: '/tesseract.svg',
 *      features: ['text', 'images', 'ocr']
 *    }
 *
 * 3. Implement provider function in this file
 *    Pattern: async function parseWithXxx(config, pdfBuffer): Promise<ParsedPdfContent>
 *    - Accept PDF as Buffer
 *    - Extract text, images, tables, formulas as needed
 *    - Return unified format:
 *      {
 *        text: string,               // Markdown or plain text
 *        images: string[],           // Base64 data URLs
 *        metadata: {
 *          pageCount: number,
 *          parser: string,
 *          ...                       // Provider-specific metadata
 *        }
 *      }
 *
 *    Example:
 *    async function parseWithTesseractOCR(
 *      config: PDFParserConfig,
 *      pdfBuffer: Buffer
 *    ): Promise<ParsedPdfContent> {
 *      const { createWorker } = await import('tesseract.js');
 *
 *      // Convert PDF pages to images
 *      const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
 *      const numPages = pdf.numPages;
 *
 *      const texts: string[] = [];
 *      const images: string[] = [];
 *
 *      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
 *        // Render page to canvas/image
 *        const page = await pdf.getPage(pageNum);
 *        const viewport = page.getViewport({ scale: 2.0 });
 *        const canvas = createCanvas(viewport.width, viewport.height);
 *        const context = canvas.getContext('2d');
 *        await page.render({ canvasContext: context, viewport }).promise;
 *
 *        // OCR the image
 *        const worker = await createWorker('eng+chi_sim');
 *        const { data: { text } } = await worker.recognize(canvas.toBuffer());
 *        texts.push(text);
 *        await worker.terminate();
 *
 *        // Save image
 *        images.push(canvas.toDataURL());
 *      }
 *
 *      return {
 *        text: texts.join('\n\n'),
 *        images,
 *        metadata: {
 *          pageCount: numPages,
 *          parser: 'tesseract-ocr',
 *        },
 *      };
 *    }
 *
 * 4. Add case to parsePDF() switch statement
 *    case 'tesseract-ocr':
 *      result = await parseWithTesseractOCR(config, pdfBuffer);
 *      break;
 *
 * 5. Add i18n translations in lib/i18n.ts
 *    providerTesseractOCR: { zh: 'Tesseract OCR', en: 'Tesseract OCR' }
 *
 * 6. Update features in constants.ts to reflect parser capabilities
 *    features: ['text', 'images', 'ocr'] // OCR-capable
 *
 * Provider Implementation Patterns:
 *
 * Pattern 1: Local Node.js Parser (like unpdf)
 * - Import parsing library
 * - Process Buffer directly
 * - Extract text and images synchronously or asynchronously
 * - Convert images to base64 data URLs
 * - Return immediately
 *
 * Pattern 2: Remote API (like MinerU)
 * - Upload PDF or provide URL
 * - Create task and get task ID
 * - Poll for completion (with timeout)
 * - Download results (text, images, metadata)
 * - Parse and convert to unified format
 *
 * Pattern 3: OCR-based Parser (Tesseract, Google Vision)
 * - Render PDF pages to images
 * - Send images to OCR service
 * - Collect text from all pages
 * - Combine with layout analysis if available
 * - Return combined text and original images
 *
 * Image Extraction Best Practices:
 * - Always convert to base64 data URLs (data:image/png;base64,...)
 * - Use PNG for lossless quality
 * - Use sharp for efficient image processing
 * - Handle errors per image (don't fail entire parsing)
 * - Log extraction failures but continue processing
 *
 * Metadata Recommendations:
 * - pageCount: Number of pages in PDF
 * - parser: Provider ID for debugging
 * - processingTime: Time taken (auto-added)
 * - taskId/jobId: For async providers (useful for troubleshooting)
 * - Custom fields: imageMapping, pdfImages, tables, formulas, etc.
 *
 * Error Handling:
 * - Validate API key if requiresApiKey is true
 * - Throw descriptive errors for missing configuration
 * - For async providers, handle timeout and polling errors
 * - Log warnings for non-critical failures (e.g., single page errors)
 * - Always include provider name in error messages
 */

import { extractText, getDocumentProxy, extractImages } from 'unpdf';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import type { PDFParserConfig } from './types';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import { PDF_PROVIDERS } from './constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('PDFProviders');

/**
 * Parse PDF using specified provider
 */
export async function parsePDF(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  const provider = PDF_PROVIDERS[config.providerId];
  if (!provider) {
    throw new Error(`Unknown PDF provider: ${config.providerId}`);
  }

  // Validate API key if required
  if (provider.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for PDF provider: ${config.providerId}`);
  }

  const startTime = Date.now();

  let result: ParsedPdfContent;

  switch (config.providerId) {
    case 'unpdf':
      result = await parseWithUnpdf(pdfBuffer);
      break;

    case 'mineru':
      result = await parseWithMinerU(config, pdfBuffer);
      break;

    default:
      throw new Error(`Unsupported PDF provider: ${config.providerId}`);
  }

  // Add processing time to metadata
  if (result.metadata) {
    result.metadata.processingTime = Date.now() - startTime;
  }

  return result;
}

/**
 * Parse PDF using unpdf (existing implementation)
 */
async function parseWithUnpdf(pdfBuffer: Buffer): Promise<ParsedPdfContent> {
  const uint8Array = new Uint8Array(pdfBuffer);
  const pdf = await getDocumentProxy(uint8Array);
  const numPages = pdf.numPages;

  // Extract text using the document proxy
  const { text: pdfText } = await extractText(pdf, {
    mergePages: true,
  });

  // Extract images using the same document proxy
  const images: string[] = [];
  const pdfImagesMeta: Array<{
    id: string;
    src: string;
    pageNumber: number;
    width: number;
    height: number;
  }> = [];
  let imageCounter = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const pageImages = await extractImages(pdf, pageNum);
      for (let i = 0; i < pageImages.length; i++) {
        const imgData = pageImages[i];
        try {
          // Use sharp to convert raw image data to PNG base64
          const pngBuffer = await sharp(Buffer.from(imgData.data), {
            raw: {
              width: imgData.width,
              height: imgData.height,
              channels: imgData.channels,
            },
          })
            .png()
            .toBuffer();

          // Convert to base64
          const base64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;
          imageCounter++;
          const imgId = `img_${imageCounter}`;
          images.push(base64);
          pdfImagesMeta.push({
            id: imgId,
            src: base64,
            pageNumber: pageNum,
            width: imgData.width,
            height: imgData.height,
          });
        } catch (sharpError) {
          log.error(`Failed to convert image ${i + 1} from page ${pageNum}:`, sharpError);
        }
      }
    } catch (pageError) {
      log.error(`Failed to extract images from page ${pageNum}:`, pageError);
    }
  }

  return {
    text: pdfText,
    images,
    metadata: {
      pageCount: numPages,
      parser: 'unpdf',
      imageMapping: Object.fromEntries(pdfImagesMeta.map((m) => [m.id, m.src])),
      pdfImages: pdfImagesMeta,
    },
  };
}

/**
 * Detect if using MinerU.net commercial API or self-hosted MinerU
 * Commercial API: baseUrl contains "mineru.net" or starts with https://api
 */
function isCommercialMinerU(baseUrl: string): boolean {
  return baseUrl.includes('mineru.net') || baseUrl.startsWith('https://api');
}

/**
 * Parse PDF using MinerU
 * Supports both:
 * 1. MinerU.net commercial API (https://mineru.net/apiManage/docs)
 * 2. Self-hosted MinerU service (https://github.com/opendatalab/MinerU)
 */
async function parseWithMinerU(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  if (!config.baseUrl) {
    throw new Error(
      'MinerU base URL is required. ' +
        'Please deploy MinerU locally or specify the server URL. ' +
        'See: https://github.com/opendatalab/MinerU',
    );
  }

  // Detect which API to use
  const isCommercial = isCommercialMinerU(config.baseUrl);

  if (isCommercial) {
    return parseWithMinerUCommercial(config, pdfBuffer);
  } else {
    return parseWithMinerUSelfHosted(config, pdfBuffer);
  }
}

/**
 * Parse PDF using MinerU.net commercial API
 * API Docs: https://mineru.net/apiManage/docs
 *
 * Flow:
 * 1. Upload file to get file_id
 * 2. POST /api/v4/extract/task to create task
 * 3. Poll GET /api/v4/extract/task/{task_id} for results
 */
async function parseWithMinerUCommercial(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  const baseUrl = config.baseUrl!.replace(/\/$/, ''); // Remove trailing slash
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('API Key is required for MinerU.net commercial API');
  }

  log.info('[MinerU Commercial] Starting PDF parsing:', baseUrl);

  // Step 1: Get upload URL
  // Use batch endpoint as per official API docs: https://mineru.net/apiManage/docs
  // Endpoint: POST /api/v4/file-urls/batch
  const uploadUrlEndpoint = `${baseUrl}/api/v4/file-urls/batch`;
  log.info('[MinerU Commercial] Requesting upload URL from:', uploadUrlEndpoint);

  const uploadUrlResponse = await fetch(uploadUrlEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: [
        {
          name: 'document.pdf',
          data_id: `pdf_${Date.now()}`,
        },
      ],
      model_version: 'vlm',
    }),
  });

  if (!uploadUrlResponse.ok) {
    const errorText = await uploadUrlResponse.text().catch(() => uploadUrlResponse.statusText);
    log.error('[MinerU Commercial] Get upload URL failed:', {
      status: uploadUrlResponse.status,
      endpoint: uploadUrlEndpoint,
      response: errorText.substring(0, 500),
    });
    throw new Error(`Failed to get upload URL (${uploadUrlResponse.status}): ${errorText}`);
  }

  const uploadData = await uploadUrlResponse.json();
  log.info('[MinerU Commercial] Upload URL response:', JSON.stringify(uploadData).substring(0, 200));

  // Extract file_urls and batch_id from response
  const fileUrls = uploadData.file_urls || uploadData.data?.file_urls;
  const batchId = uploadData.batch_id || uploadData.data?.batch_id;

  if (!fileUrls || fileUrls.length === 0) {
    throw new Error('Invalid upload URL response: missing file_urls');
  }

  const uploadUrl = fileUrls[0];
  log.info('[MinerU Commercial] Got upload URL, uploading file...');

  // Step 2: Upload file to the presigned URL using PUT
  // Note: Do NOT add any headers - the presigned URL already contains all necessary auth
  log.info('[MinerU Commercial] Uploading file to OSS, size:', pdfBuffer.length, 'bytes');
  log.info('[MinerU Commercial] Upload URL (first 100 chars):', uploadUrl.substring(0, 100));

  const uploadStartTime = Date.now();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(pdfBuffer),
  });
  const uploadDuration = Date.now() - uploadStartTime;

  log.info('[MinerU Commercial] OSS upload response status:', uploadResponse.status);
  log.info('[MinerU Commercial] OSS upload duration:', uploadDuration, 'ms');

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => uploadResponse.statusText);
    log.error('[MinerU Commercial] OSS upload failed:', errorText.substring(0, 500));
    throw new Error(`Failed to upload file (${uploadResponse.status}): ${errorText}`);
  }

  log.info('[MinerU Commercial] File uploaded to OSS successfully, batch_id:', batchId);
  log.info('[MinerU Commercial] Waiting 2 seconds for MinerU to process file upload...');

  // Wait a moment for MinerU to detect the file upload
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Query batch results
  // For batch API, use GET /api/v4/extract-results/batch/{batch_id}
  const batchResult = await pollMinerUCommercialBatch(baseUrl, apiKey, batchId);

  return await extractMinerUCommercialResult(batchResult);
}

/**
 * Poll MinerU commercial batch API for results
 * Endpoint: GET /api/v4/extract-results/batch/{batch_id}
 */
async function pollMinerUCommercialBatch(
  baseUrl: string,
  apiKey: string,
  batchId: string,
  maxAttempts = 120, // 10 minutes (120 * 5s = 600s)
  intervalMs = 5000, // 5 seconds between polls
): Promise<Record<string, unknown>> {
  if (!batchId) {
    throw new Error('batch_id is required for polling');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info(`[MinerU Commercial] Polling batch... (${attempt}/${maxAttempts})`);

    const response = await fetch(`${baseUrl}/api/v4/extract-results/batch/${batchId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to poll task (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const taskData = data.data || data;

    // MinerU API returns extract_result array with state field for each file
    const extractResultArray = taskData.extract_result as Array<Record<string, unknown>> | undefined;
    const extractResult = extractResultArray?.[0] || taskData;
    const state = (extractResult.state || taskData.state || taskData.status) as string;
    const errMsg = (extractResult.err_msg || extractResult.error_message) as string | undefined;

    // Log full response for debugging (first 3 attempts and then every 10)
    if (attempt <= 3 || attempt % 10 === 0) {
      log.info(`[MinerU Commercial] Full response (attempt ${attempt}):`, JSON.stringify(taskData).substring(0, 800));
    }

    log.info(`[MinerU Commercial] Batch state: ${state}, attempt: ${attempt}/${maxAttempts}`);

    if (state === 'done' || state === 'completed' || state === 'success') {
      log.info('[MinerU Commercial] Task completed!');
      return extractResult as Record<string, unknown>;
    }

    if (state === 'failed' || state === 'error') {
      log.error('[MinerU Commercial] Task failed:', errMsg);
      throw new Error(`Task failed: ${errMsg || 'Unknown error'}`);
    }

    // Task is still processing, wait and retry
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Task polling timeout after ${maxAttempts} attempts`);
}

/**
 * Extract ParsedPdfContent from MinerU commercial API result
 * MinerU returns a zip file URL that we need to download and extract
 */
async function extractMinerUCommercialResult(taskData: Record<string, unknown>): Promise<ParsedPdfContent> {
  // MinerU API returns result in extract_result array
  const extractResultArray = taskData.extract_result as Array<Record<string, unknown>> | undefined;
  const extractResult = (extractResultArray?.[0] || taskData.result || taskData) as Record<string, unknown>;

  // Check if result contains zip URL (MinerU commercial API returns full_zip_url)
  const zipUrl = extractResult.full_zip_url as string | undefined;

  if (zipUrl) {
    log.info('[MinerU Commercial] Downloading result zip:', zipUrl);
    return downloadAndExtractMinerUResult(zipUrl);
  }

  // Fallback to direct result parsing (if API changes)
  const result = extractResult;

  // Extract markdown content
  const markdown: string = (result.markdown as string) ||
    (result.md_content as string) ||
    (result.text as string) ||
    '';

  // Extract images
  const images: string[] = [];
  const pdfImages: Array<{
    id: string;
    src: string;
    pageNumber: number;
    description?: string;
  }> = [];

  const imageList = (result.images || result.image_list || []) as Array<Record<string, unknown> | string>;
  if (Array.isArray(imageList)) {
    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      const imageUrl = typeof img === 'string'
        ? img
        : (img.url as string) || (img.src as string) || (img.image_url as string);
      if (imageUrl) {
        images.push(imageUrl);
        pdfImages.push({
          id: `img_${i + 1}`,
          src: imageUrl,
          pageNumber: typeof img === 'object' && img.page_idx !== undefined ? (img.page_idx as number) + 1 : 0,
          description: typeof img === 'object' ? (img.caption as string) || (img.description as string) : undefined,
        });
      }
    }
  }

  // Extract page count
  const pageCount = (result.page_count as number) ||
    (result.pageCount as number) ||
    (result.num_pages as number) ||
    ((result.pages as unknown[])?.length || 0);

  log.info(
    `[MinerU Commercial] Parsed successfully: ${images.length} images, ` +
      `${markdown.length} chars of markdown, ${pageCount} pages`,
  );

  return {
    text: markdown,
    images,
    metadata: {
      pageCount,
      parser: 'mineru-commercial',
      pdfImages,
      taskId: taskData.task_id as string,
    },
  };
}

/**
 * Download and extract MinerU result zip file
 * MinerU commercial API returns a zip file containing the parsed results
 */
async function downloadAndExtractMinerUResult(zipUrl: string): Promise<ParsedPdfContent> {
  log.info('[MinerU Commercial] Downloading zip file:', zipUrl);

  const response = await fetch(zipUrl);

  if (!response.ok) {
    throw new Error(`Failed to download result zip: ${response.status} ${response.statusText}`);
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer());
  log.info('[MinerU Commercial] Downloaded zip file, size:', zipBuffer.byteLength, 'bytes');

  try {
    // Extract zip using adm-zip
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    log.info('[MinerU Commercial] Zip entries:', zipEntries.map((e: { entryName: string }) => e.entryName).join(', '));

    // Find full.md (main markdown content)
    const mdEntry = zipEntries.find((entry: { entryName: string }) => entry.entryName === 'full.md');
    const contentListEntry = zipEntries.find((entry: { entryName: string }) => entry.entryName === 'content_list_v2.json');

    let markdown = '';
    let pageCount = 0;
    const images: string[] = [];
    const pdfImages: Array<{ id: string; src: string; pageNumber: number; description?: string }> = [];

    // Extract markdown content
    if (mdEntry) {
      markdown = mdEntry.getData().toString('utf-8');
      log.info('[MinerU Commercial] Extracted markdown, length:', markdown.length);
    } else {
      log.warn('[MinerU Commercial] full.md not found in zip');
    }

    // Parse content_list_v2.json for images and page info
    if (contentListEntry) {
      try {
        const contentList = JSON.parse(contentListEntry.getData().toString('utf-8'));
        if (Array.isArray(contentList)) {
          const pages = new Set(contentList.map(item => item.page_idx).filter((v): v is number => v != null));
          pageCount = pages.size;

          // Extract images from content list
          for (const item of contentList) {
            if (item.type === 'image' && item.img_path) {
              // Try to find the image in zip entries
              const imageName = item.img_path.split('/').pop();
              const imageEntry = zipEntries.find((e: { entryName: string }) => e.entryName === imageName || e.entryName.endsWith(`/${imageName}`));

              if (imageEntry) {
                const imageBuffer = imageEntry.getData();
                const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
                images.push(base64);
                pdfImages.push({
                  id: `img_${pdfImages.length + 1}`,
                  src: base64,
                  pageNumber: item.page_idx != null ? item.page_idx + 1 : 0,
                  description: item.image_caption?.[0],
                });
              }
            }
          }
        }
      } catch (e) {
        log.warn('[MinerU Commercial] Failed to parse content_list_v2.json:', e);
      }
    }

    log.info(
      `[MinerU Commercial] Parsed successfully: ${images.length} images, ` +
      `${markdown.length} chars of markdown, ${pageCount} pages`
    );

    return {
      text: markdown,
      images,
      metadata: {
        pageCount,
        parser: 'mineru-commercial',
        zipUrl,
        pdfImages,
      },
    };
  } catch (e) {
    log.error('[MinerU Commercial] Failed to extract zip:', e);
    throw new Error(`Failed to extract result zip: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

/**
 * Parse PDF using self-hosted MinerU service (mineru-api)
 *
 * Official MinerU API endpoint:
 * POST /file_parse  (multipart/form-data)
 *
 * Response format:
 * { results: { "document.pdf": { md_content, images, content_list, ... } } }
 *
 * @see https://github.com/opendatalab/MinerU
 */
async function parseWithMinerUSelfHosted(
  config: PDFParserConfig,
  pdfBuffer: Buffer,
): Promise<ParsedPdfContent> {
  const baseUrl = config.baseUrl!.replace(/\/$/, '');
  log.info('[MinerU Self-Hosted] Parsing PDF with MinerU server:', baseUrl);

  const fileName = 'document.pdf';

  // Create FormData for file upload
  const formData = new FormData();

  // Convert Buffer to Blob
  const arrayBuffer = pdfBuffer.buffer.slice(
    pdfBuffer.byteOffset,
    pdfBuffer.byteOffset + pdfBuffer.byteLength,
  );
  const blob = new Blob([arrayBuffer as ArrayBuffer], {
    type: 'application/pdf',
  });
  formData.append('files', blob, fileName);

  // MinerU API form fields
  formData.append('parse_method', 'auto');
  formData.append('backend', 'pipeline');
  formData.append('return_content_list', 'true');
  formData.append('return_images', 'true');

  // API key (if required by deployment)
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // POST /file_parse
  const response = await fetch(`${baseUrl}/file_parse`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`MinerU API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();

  // Response: { results: { "<fileName>": { md_content, images, content_list, ... } } }
  const fileResult = json.results?.[fileName];
  if (!fileResult) {
    const keys = json.results ? Object.keys(json.results) : [];
    const fallback = keys.length > 0 ? json.results[keys[0]] : null;
    if (!fallback) {
      throw new Error(`MinerU returned no results. Response keys: ${JSON.stringify(keys)}`);
    }
    log.warn(`[MinerU] Filename mismatch, using key "${keys[0]}" instead of "${fileName}"`);
    return extractMinerUSelfHostedResult(fallback);
  }

  return extractMinerUSelfHostedResult(fileResult);
}

/** Extract ParsedPdfContent from self-hosted MinerU result */
function extractMinerUSelfHostedResult(fileResult: Record<string, unknown>): ParsedPdfContent {
  const markdown: string = (fileResult.md_content as string) || '';
  const imageData: Record<string, string> = {};
  let pageCount = 0;

  // Extract images from the images object (key → base64 string)
  if (fileResult.images && typeof fileResult.images === 'object') {
    Object.entries(fileResult.images as Record<string, string>).forEach(([key, value]) => {
      imageData[key] = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
    });
  }

  // Parse content_list to build image metadata lookup (img_path → metadata)
  const imageMetaLookup = new Map<string, { pageIdx: number; bbox: number[]; caption?: string }>();
  const contentList =
    typeof fileResult.content_list === 'string'
      ? JSON.parse(fileResult.content_list as string)
      : fileResult.content_list;
  if (Array.isArray(contentList)) {
    const pages = new Set(
      contentList
        .map((item: Record<string, unknown>) => item.page_idx)
        .filter((v: unknown) => v != null),
    );
    pageCount = pages.size;

    for (const item of contentList) {
      if (item.type === 'image' && item.img_path) {
        const metaEntry = {
          pageIdx: item.page_idx ?? 0,
          bbox: item.bbox || [0, 0, 1000, 1000],
          caption: Array.isArray(item.image_caption) ? item.image_caption[0] : undefined,
        };
        // Store under both the full path and basename so lookup works
        // regardless of whether images dict uses "abc.jpg" or "images/abc.jpg"
        imageMetaLookup.set(item.img_path, metaEntry);
        const basename = item.img_path.split('/').pop();
        if (basename && basename !== item.img_path) {
          imageMetaLookup.set(basename, metaEntry);
        }
      }
    }
  }

  // Build image mapping and pdfImages array
  const imageMapping: Record<string, string> = {};
  const pdfImages: Array<{
    id: string;
    src: string;
    pageNumber: number;
    description?: string;
    width?: number;
    height?: number;
  }> = [];

  Object.entries(imageData).forEach(([key, base64Url], index) => {
    const imageId = key.startsWith('img_') ? key : `img_${index + 1}`;
    imageMapping[imageId] = base64Url;
    // Try exact key first, then with 'images/' prefix (MinerU content_list uses prefixed paths)
    const meta = imageMetaLookup.get(key) || imageMetaLookup.get(`images/${key}`);
    pdfImages.push({
      id: imageId,
      src: base64Url,
      pageNumber: meta ? meta.pageIdx + 1 : 0,
      description: meta?.caption,
      width: meta ? meta.bbox[2] - meta.bbox[0] : undefined,
      height: meta ? meta.bbox[3] - meta.bbox[1] : undefined,
    });
  });

  const images = Object.values(imageMapping);

  log.info(
    `[MinerU] Parsed successfully: ${images.length} images, ` +
      `${markdown.length} chars of markdown`,
  );

  return {
    text: markdown,
    images,
    metadata: {
      pageCount,
      parser: 'mineru',
      imageMapping,
      pdfImages,
    },
  };
}

/**
 * Get current PDF parser configuration from settings store
 * Note: This function should only be called in browser context
 */
export async function getCurrentPDFConfig(): Promise<PDFParserConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentPDFConfig() can only be called in browser context');
  }

  // Dynamic import to avoid circular dependency
  const { useSettingsStore } = await import('@/lib/store/settings');
  const { pdfProviderId, pdfProvidersConfig } = useSettingsStore.getState();

  const providerConfig = pdfProvidersConfig?.[pdfProviderId];

  return {
    providerId: pdfProviderId,
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl,
  };
}

// Re-export from constants for convenience
export { getAllPDFProviders, getPDFProvider } from './constants';
