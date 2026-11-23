import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseHexColor, renderTextAnnotationPng } from './annotations.ts';
import { compressImages, type CompressPreset, type Encoder } from './compress.ts';
import { isFixedPaper, resolvePageSize, type PageSizeMode } from './pageSize.ts';
import type { Annotation, PageItem } from './state.ts';
import { loadSystemFont } from './systemFont.ts';

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
  byteLength: number;
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
    byteLength: bytes.byteLength,
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
      const doc = source.pdfjsDoc as unknown as {
        destroy?: () => Promise<void>;
        cleanup?: () => Promise<void>;
      };
      if (typeof doc.destroy === 'function') {
        void doc.destroy();
      } else if (typeof doc.cleanup === 'function') {
        void doc.cleanup();
      }
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
  targetWidth = 180,
  extraRotation = 0
): Promise<{ width: number; height: number }> {
  if (!source.pdfjsDoc) {
    throw new Error('Preview document is not loaded');
  }
  const page = await source.pdfjsDoc.getPage(pageIndex + 1);
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const totalRotation = normalizeDegrees(page.rotate + extraRotation);
  const unscaled = page.getViewport({ scale: 1, rotation: totalRotation });
  const cssScale = targetWidth / unscaled.width;
  const cssWidth = Math.round(unscaled.width * cssScale);
  const cssHeight = Math.round(unscaled.height * cssScale);

  const renderViewport = page.getViewport({ scale: cssScale * dpr, rotation: totalRotation });
  canvas.width = Math.max(1, Math.round(renderViewport.width));
  canvas.height = Math.max(1, Math.round(renderViewport.height));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D canvas context');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: ctx,
    viewport: renderViewport,
  }).promise;

  return { width: cssWidth, height: cssHeight };
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export interface ExportOptions {
  stripMetadata: boolean;
  pageSize?: PageSizeMode;
  compress?: CompressPreset;
  compressEncoder?: Encoder;
}

const PX_TO_PT_96DPI = 0.75;

function findFirstPdfPageSize(
  pages: PageItem[],
  sources: Map<string, LoadedSource>
): [number, number] | null {
  for (const item of pages) {
    const src = sources.get(item.sourceId);
    if (src && src.kind === 'pdf') {
      const page = src.pdfDoc.getPage(item.pageIndex);
      const { width, height } = page.getSize();
      return [width, height];
    }
  }
  return null;
}

export async function exportPagesToPdf(
  pages: PageItem[],
  sources: Map<string, LoadedSource>,
  options: ExportOptions
): Promise<Uint8Array> {
  const pageSizeMode: PageSizeMode = options.pageSize ?? 'auto';
  const normalizeAllPdfPages = isFixedPaper(pageSizeMode);
  const firstPdfSize = findFirstPdfPageSize(pages, sources);

  const outDoc = await PDFDocument.create({
    updateMetadata: !options.stripMetadata,
  });
  outDoc.registerFontkit(fontkit);

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

  // Group page indices per PDF source so copyPages / embedPages is called once per source
  // (calling per page duplicates shared fonts/images).
  const indicesBySource = new Map<string, number[]>();
  const itemCopySlot = new Map<PageItem, number>();

  for (const item of pages) {
    const src = sources.get(item.sourceId);
    if (!src) {
      throw new Error(`Missing source ${item.sourceId}`);
    }
    if (src.kind === 'pdf') {
      let indices = indicesBySource.get(item.sourceId);
      if (!indices) {
        indices = [];
        indicesBySource.set(item.sourceId, indices);
      }
      itemCopySlot.set(item, indices.length);
      indices.push(item.pageIndex);
    }
  }

  const copiedBySource = new Map<string, PDFPage[]>();
  const embeddedBySource = new Map<string, Array<PDFEmbeddedPage | null>>();
  for (const [sourceId, indices] of indicesBySource) {
    const src = sources.get(sourceId) as LoadedPdfSource;
    if (normalizeAllPdfPages) {
      const srcPages = indices.map((idx) => src.pdfDoc.getPage(idx));
      const nonEmptyIndices: number[] = [];
      const nonEmptyPages: PDFPage[] = [];
      srcPages.forEach((p, slot) => {
        if (p.node.Contents()) {
          nonEmptyIndices.push(slot);
          nonEmptyPages.push(p);
        }
      });
      const slots: Array<PDFEmbeddedPage | null> = new Array(srcPages.length).fill(null);
      if (nonEmptyPages.length > 0) {
        const embeddedPages = await outDoc.embedPages(nonEmptyPages);
        nonEmptyIndices.forEach((slot, i) => {
          slots[slot] = embeddedPages[i];
        });
      }
      embeddedBySource.set(sourceId, slots);
    } else {
      const copiedPages = await outDoc.copyPages(src.pdfDoc, indices);
      copiedBySource.set(sourceId, copiedPages);
    }
  }

  const hasTextAnnotations = pages.some((p) => p.annotations?.some((a) => a.kind === 'text'));
  const textFontCtx = hasTextAnnotations ? await prepareTextFontContext(outDoc) : null;

  for (const item of pages) {
    const src = sources.get(item.sourceId)!;

    if (src.kind === 'pdf') {
      const slot = itemCopySlot.get(item)!;
      if (normalizeAllPdfPages) {
        const srcPage = src.pdfDoc.getPage(item.pageIndex);
        const existingAngle = srcPage.getRotation().angle;
        const embedded = embeddedBySource.get(item.sourceId)![slot];
        const srcSize = srcPage.getSize();
        const itemWidth = embedded ? embedded.width : srcSize.width;
        const itemHeight = embedded ? embedded.height : srcSize.height;
        const [pageWidth, pageHeight] = resolvePageSize(pageSizeMode, firstPdfSize, [
          itemWidth,
          itemHeight,
        ]);
        const page = outDoc.addPage([pageWidth, pageHeight]);
        let annRegion = { x: 0, y: 0, width: pageWidth, height: pageHeight };

        if (embedded) {
          const scale = Math.min(pageWidth / embedded.width, pageHeight / embedded.height);
          const drawWidth = embedded.width * scale;
          const drawHeight = embedded.height * scale;
          const x = (pageWidth - drawWidth) / 2;
          const y = (pageHeight - drawHeight) / 2;
          annRegion = { x, y, width: drawWidth, height: drawHeight };

          page.drawPage(embedded, {
            x,
            y,
            width: drawWidth,
            height: drawHeight,
          });
        }

        const finalAngle = normalizeDegrees(existingAngle + item.rotation);
        if (finalAngle !== 0) {
          page.setRotation(degrees(finalAngle));
        }

        if (item.annotations?.length) {
          await drawAnnotationsOnPage(outDoc, page, item.annotations, annRegion, textFontCtx);
        }
      } else {
        const copied = copiedBySource.get(item.sourceId)![slot];
        const existingAngle = copied.getRotation().angle;
        copied.setRotation(degrees(normalizeDegrees(existingAngle + item.rotation)));
        outDoc.addPage(copied);

        if (item.annotations?.length) {
          const { width, height } = copied.getSize();
          await drawAnnotationsOnPage(
            outDoc,
            copied,
            item.annotations,
            {
              x: 0,
              y: 0,
              width,
              height,
            },
            textFontCtx
          );
        }
      }
    } else {
      const embedded =
        src.mimeType === 'image/png'
          ? await outDoc.embedPng(src.bytes)
          : await outDoc.embedJpg(src.bytes);
      const itemPtSize: [number, number] = [
        embedded.width * PX_TO_PT_96DPI,
        embedded.height * PX_TO_PT_96DPI,
      ];
      const [pageWidth, pageHeight] = resolvePageSize(pageSizeMode, firstPdfSize, itemPtSize);
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
        page.setRotation(degrees(normalizeDegrees(item.rotation)));
      }

      if (item.annotations?.length) {
        await drawAnnotationsOnPage(
          outDoc,
          page,
          item.annotations,
          {
            x,
            y,
            width: drawWidth,
            height: drawHeight,
          },
          textFontCtx
        );
      }
    }
  }

  if (options.compress && options.compress !== 'off') {
    await compressImages(outDoc, options.compress, options.compressEncoder);
  }

  return outDoc.save();
}

interface TextFontContext {
  font: PDFFont;
  supportsText: (text: string) => boolean;
}

async function prepareTextFontContext(outDoc: PDFDocument): Promise<TextFontContext | null> {
  try {
    const sysFont = await loadSystemFont();
    if (!sysFont) return null;

    const fkFont = fontkit.create(sysFont.bytes);
    const glyphCache = new Map<number, boolean>();
    const font = await outDoc.embedFont(sysFont.bytes, { subset: true });

    const hasGlyph = (cp: number): boolean => {
      let cached = glyphCache.get(cp);
      if (cached === undefined) {
        cached = fkFont.hasGlyphForCodePoint(cp);
        glyphCache.set(cp, cached);
      }
      return cached;
    };

    const supportsText = (text: string): boolean => {
      for (const ch of text) {
        if (ch === '\n' || ch === '\r') continue;
        const cp = ch.codePointAt(0);
        if (cp === undefined || !hasGlyph(cp)) {
          return false;
        }
      }
      return true;
    };

    return { font, supportsText };
  } catch {
    return null;
  }
}

async function drawAnnotationsOnPage(
  outDoc: PDFDocument,
  page: PDFPage,
  annotations: Annotation[],
  region: { x: number; y: number; width: number; height: number },
  textFontCtx: TextFontContext | null
): Promise<void> {
  for (const ann of annotations) {
    if (ann.kind === 'rect') {
      const { r, g, b } = parseHexColor(ann.color);
      const w = ann.w * region.width;
      const h = ann.h * region.height;
      const x = region.x + ann.x * region.width;
      const y = region.y + region.height - ann.y * region.height - h;
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(r, g, b),
        borderWidth: ann.stroke,
        color: undefined,
      });
    } else if (ann.kind === 'highlight') {
      const { r, g, b } = parseHexColor(ann.color);
      const w = ann.w * region.width;
      const h = ann.h * region.height;
      const x = region.x + ann.x * region.width;
      const y = region.y + region.height - ann.y * region.height - h;
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(r, g, b),
        opacity: 0.35,
      });
    } else if (ann.kind === 'text') {
      let drewVectorText = false;
      if (textFontCtx && ann.text && textFontCtx.supportsText(ann.text)) {
        try {
          const { r, g, b } = parseHexColor(ann.color);
          const color = rgb(r, g, b);
          const lines = ann.text.split(/\r?\n/);
          const lineHeight = ann.size * 1.25;
          const x = region.x + ann.x * region.width;
          const top = region.y + region.height - ann.y * region.height;
          const firstBaseline = top - ann.size * 0.88;

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].length > 0) {
              page.drawText(lines[i], {
                x,
                y: firstBaseline - i * lineHeight,
                size: ann.size,
                font: textFontCtx.font,
                color,
              });
            }
          }
          drewVectorText = true;
        } catch {
          drewVectorText = false;
        }
      }

      if (!drewVectorText) {
        const rendered = await renderTextAnnotationPng(ann.text, ann.size, ann.color);
        if (rendered) {
          const embeddedText = await outDoc.embedPng(rendered.pngBytes);
          const x = region.x + ann.x * region.width;
          const y = region.y + region.height - ann.y * region.height - rendered.heightPt;
          page.drawImage(embeddedText, {
            x,
            y,
            width: rendered.widthPt,
            height: rendered.heightPt,
          });
        }
      }
    }
  }
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
