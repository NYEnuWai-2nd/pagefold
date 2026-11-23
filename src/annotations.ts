import type { Rotation } from './state.ts';

export interface NormPoint {
  x: number;
  y: number;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampMoveOrigin(pos: number, size: number): number {
  const maxPos = Math.max(0, 1 - clamp01(size));
  return Math.max(0, Math.min(maxPos, Number.isFinite(pos) ? pos : 0));
}

/**
 * Map a normalized point (0..1, origin top-left) from the rotated view space
 * back to the page's unrotated normalized space (0..1, origin top-left).
 */
export function toPageCoords(pt: NormPoint, rotation: Rotation): NormPoint {
  const x = clamp01(pt.x);
  const y = clamp01(pt.y);
  switch (rotation) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}

/**
 * Map a normalized point (0..1, origin top-left) from the page's unrotated space
 * to the rotated view space (0..1, origin top-left).
 */
export function toViewCoords(pt: NormPoint, rotation: Rotation): NormPoint {
  const x = clamp01(pt.x);
  const y = clamp01(pt.y);
  switch (rotation) {
    case 90:
      return { x: 1 - y, y: x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}

export function toPageRect(rect: NormRect, rotation: Rotation): NormRect {
  const c1 = toPageCoords({ x: rect.x, y: rect.y }, rotation);
  const c2 = toPageCoords({ x: rect.x + rect.w, y: rect.y + rect.h }, rotation);
  const minX = Math.min(c1.x, c2.x);
  const minY = Math.min(c1.y, c2.y);
  return {
    x: minX,
    y: minY,
    w: Math.max(c1.x, c2.x) - minX,
    h: Math.max(c1.y, c2.y) - minY,
  };
}

export function toViewRect(rect: NormRect, rotation: Rotation): NormRect {
  const c1 = toViewCoords({ x: rect.x, y: rect.y }, rotation);
  const c2 = toViewCoords({ x: rect.x + rect.w, y: rect.y + rect.h }, rotation);
  const minX = Math.min(c1.x, c2.x);
  const minY = Math.min(c1.y, c2.y);
  return {
    x: minX,
    y: minY,
    w: Math.max(c1.x, c2.x) - minX,
    h: Math.max(c1.y, c2.y) - minY,
  };
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16) / 255;
    const g = parseInt(cleaned[1] + cleaned[1], 16) / 255;
    const b = parseInt(cleaned[2] + cleaned[2], 16) / 255;
    return {
      r: Number.isFinite(r) ? r : 0,
      g: Number.isFinite(g) ? g : 0,
      b: Number.isFinite(b) ? b : 0,
    };
  }
  if (cleaned.length >= 6) {
    const r = parseInt(cleaned.slice(0, 2), 16) / 255;
    const g = parseInt(cleaned.slice(2, 4), 16) / 255;
    const b = parseInt(cleaned.slice(4, 6), 16) / 255;
    return {
      r: Number.isFinite(r) ? r : 0,
      g: Number.isFinite(g) ? g : 0,
      b: Number.isFinite(b) ? b : 0,
    };
  }
  return { r: 0, g: 0, b: 0 };
}

const TEXT_FONT_STACK = '"Segoe UI","Hiragino Sans","Yu Gothic UI","Noto Sans JP",sans-serif';
const TEXT_LINE_HEIGHT = 1.25;
const TEXT_RENDER_SCALE = 4;

/**
 * Render multi-line text onto a transparent 4x offscreen canvas and return PNG bytes + point size.
 * Returns null in non-DOM environments (e.g., Node unit tests).
 */
export async function renderTextAnnotationPng(
  text: string,
  sizePt: number,
  color: string
): Promise<{ pngBytes: Uint8Array; widthPt: number; heightPt: number } | null> {
  if (typeof document === 'undefined' || !text) return null;

  const lines = text.split(/\r?\n/);
  const lineHeightPt = sizePt * TEXT_LINE_HEIGHT;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) return null;

  measureCtx.font = `${sizePt}px ${TEXT_FONT_STACK}`;
  let maxLineWidthPt = 0;
  for (const line of lines) {
    const metrics = measureCtx.measureText(line || ' ');
    maxLineWidthPt = Math.max(maxLineWidthPt, metrics.width);
  }

  const widthPt = Math.max(4, Math.ceil(maxLineWidthPt + 2));
  const heightPt = Math.max(lineHeightPt, Math.ceil(lines.length * lineHeightPt + 2));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(widthPt * TEXT_RENDER_SCALE));
  canvas.height = Math.max(1, Math.ceil(heightPt * TEXT_RENDER_SCALE));

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(TEXT_RENDER_SCALE, TEXT_RENDER_SCALE);
  ctx.font = `${sizePt}px ${TEXT_FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, i * lineHeightPt);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return {
    pngBytes: new Uint8Array(buf),
    widthPt,
    heightPt,
  };
}
