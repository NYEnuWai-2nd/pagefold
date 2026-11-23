import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageItem } from './state.ts';

export class EncryptedPdfError extends Error {
  constructor(fileName: string) {
    super(`Encrypted PDF: ${fileName}`);
    this.name = 'EncryptedPdfError';
  }
}

export type ImageMimeType = 'image/png' | 'image/jpeg';

export interface LoadedPdfSource {
  kind: 'pdf';
  name: string;
  pdfDoc: PDFDocument;
  pdfjsDoc: pdfjsLib.PDFDocumentProxy | null;
  pageCount: number;
}

export interface LoadedImageSource {
  kind: 'image';
  name: string;
  mimeType: ImageMimeType;
  bytes: Uint8Array;
  objectUrl: string | null;
  pageCount: 1;
}

export type LoadedSource = LoadedPdfSource | LoadedImageSource;

let workerConfigured = false;
function ensurePdfJsWorker(): void {
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
    workerConfigured = true;
  }
}

export function detectFileKind(fileName: string): 'pdf' | 'image-png' | 'image-jpeg' | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.png')) return 'image-png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image-jpeg';
  return null;
}

export async function loadPdfSource(
  name: string,
  bytes: Uint8Array,
  options: { withPreview?: boolean } = {}
): Promise<LoadedPdfSource> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('encrypt')) {
      throw new EncryptedPdfError(name);
    }
    throw err;
  }

  let pdfjsDoc: pdfjsLib.PDFDocumentProxy | null = null;
  if (options.withPreview !== false) {
    ensurePdfJsWorker();
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
    pdfjsDoc = await loadingTask.promise;
  }

  return {
    kind: 'pdf',
    name,
    pdfDoc,
    pdfjsDoc,
    pageCount: pdfDoc.getPageCount(),
  };
}

export function loadImageSource(
  name: string,
  mimeType: ImageMimeType,
  bytes: Uint8Array,
  options: { withPreview?: boolean } = {}
): LoadedImageSource {
  let objectUrl: string | null = null;
  if (options.withPreview !== false && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    objectUrl = URL.createObjectURL(new Blob([copy], { type: mimeType }));
  }

  return {
    kind: 'image',
    name,
    mimeType,
    bytes,
    objectUrl,
    pageCount: 1,
  };
}

export function disposeLoadedSource(source: LoadedSource): void {
  if (source.kind === 'pdf') {
    if (source.pdfjsDoc) {
      void source.pdfjsDoc.cleanup();
      source.pdfjsDoc = null;
    }
  } else if (source.objectUrl && typeof URL !== 'undefined') {
    URL.revokeObjectURL(source.objectUrl);
    source.objectUrl = null;
  }
}

export async function renderPdfThumbnail(
  source: LoadedPdfSource,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  targetWidth = 180
): Promise<{ width: number; height: number }> {
  if (!source.pdfjsDoc) {
    throw new Error('Preview document is not loaded');
  }
  const page = await source.pdfjsDoc.getPage(pageIndex + 1);
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const unscaled = page.getViewport({ scale: 1 });
  const cssScale = targetWidth / unscaled.width;
  const cssWidth = Math.round(unscaled.width * cssScale);
  const cssHeight = Math.round(unscaled.height * cssScale);

  const renderViewport = page.getViewport({ scale: cssScale * dpr });
  canvas.width = Math.max(1, Math.round(renderViewport.width));
  canvas.height = Math.max(1, Math.round(renderViewport.height));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D canvas context');
  }

  await page.render({
    canvas,
    canvasContext: ctx,
    viewport: renderViewport,
  }).promise;

  return { width: cssWidth, height: cssHeight };
}

const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

export interface ExportOptions {
  stripMetadata: boolean;
}

export async function exportPagesToPdf(
  pages: PageItem[],
  sources: Map<string, LoadedSource>,
  options: ExportOptions
): Promise<Uint8Array> {
  const outDoc = await PDFDocument.create({
    updateMetadata: !options.stripMetadata,
  });

  if (options.stripMetadata) {
    outDoc.setProducer('');
    outDoc.setCreator('');
  } else {
    const firstPdf = findFirstPdfSource(pages, sources);
    if (firstPdf) {
      const title = firstPdf.getTitle();
      if (title) outDoc.setTitle(title);
      const author = firstPdf.getAuthor();
      if (author) outDoc.setAuthor(author);
      const subject = firstPdf.getSubject();
      if (subject) outDoc.setSubject(subject);
      const keywords = firstPdf.getKeywords();
      if (keywords) {
        const list = keywords
          .split(/[,;]+/)
          .map((k) => k.trim())
          .filter(Boolean);
        if (list.length > 0) {
          outDoc.setKeywords(list);
        }
      }
    }
  }

  for (const item of pages) {
    const src = sources.get(item.sourceId);
    if (!src) {
      throw new Error(`Missing source ${item.sourceId}`);
    }

    if (src.kind === 'pdf') {
      const [copied] = await outDoc.copyPages(src.pdfDoc, [item.pageIndex]);
      const existingAngle = copied.getRotation().angle;
      copied.setRotation(degrees(existingAngle + item.rotation));
      outDoc.addPage(copied);
    } else {
      const embedded =
        src.mimeType === 'image/png'
          ? await outDoc.embedPng(src.bytes)
          : await outDoc.embedJpg(src.bytes);
      const isLandscape = embedded.width > embedded.height;
      const [pageWidth, pageHeight] = isLandscape ? A4_LANDSCAPE : A4_PORTRAIT;
      const page = outDoc.addPage([pageWidth, pageHeight]);

      const scale = Math.min(pageWidth / embedded.width, pageHeight / embedded.height);
      const drawWidth = embedded.width * scale;
      const drawHeight = embedded.height * scale;
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;

      page.drawImage(embedded, {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
      });

      if (item.rotation !== 0) {
        page.setRotation(degrees(item.rotation));
      }
    }
  }

  return outDoc.save();
}

function findFirstPdfSource(
  pages: PageItem[],
  sources: Map<string, LoadedSource>
): PDFDocument | null {
  for (const item of pages) {
    const src = sources.get(item.sourceId);
    if (src && src.kind === 'pdf') {
      return src.pdfDoc;
    }
  }
  for (const src of sources.values()) {
    if (src.kind === 'pdf') {
      return src.pdfDoc;
    }
  }
  return null;
}
