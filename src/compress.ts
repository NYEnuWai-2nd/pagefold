import {
  PDFArray,
  PDFBool,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFStream,
} from 'pdf-lib';

export type CompressPreset = 'off' | 'light' | 'standard' | 'strong';
export type ActiveCompressPreset = Exclude<CompressPreset, 'off'>;

export interface CompressPresetConfig {
  maxSide: number;
  quality: number;
}

export const COMPRESS_PRESETS: Record<ActiveCompressPreset, CompressPresetConfig> = {
  light: { maxSide: 2400, quality: 0.85 },
  standard: { maxSide: 1800, quality: 0.72 },
  strong: { maxSide: 1200, quality: 0.55 },
};

export function isCompressPreset(value: string): value is CompressPreset {
  return value === 'off' || value === 'light' || value === 'standard' || value === 'strong';
}

export type Encoder = (
  jpegBytes: Uint8Array,
  maxSide: number,
  quality: number
) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

export interface CompressResult {
  before: number;
  after: number;
  count: number;
}

export const MIN_COMPRESS_BYTES = 100 * 1024;

function isDctDecodeFilter(filter: PDFObject | undefined, context: PDFContext): boolean {
  const resolved = context.lookup(filter);
  if (resolved instanceof PDFName) {
    return resolved === PDFName.of('DCTDecode');
  }
  if (resolved instanceof PDFArray) {
    return resolved.size() === 1 && context.lookup(resolved.get(0)) === PDFName.of('DCTDecode');
  }
  return false;
}

function isSupportedColorSpace(colorSpace: PDFObject | undefined, context: PDFContext): boolean {
  const resolved = context.lookup(colorSpace);
  if (resolved instanceof PDFName) {
    return resolved === PDFName.of('DeviceRGB') || resolved === PDFName.of('DeviceGray');
  }
  if (resolved instanceof PDFArray) {
    if (resolved.size() < 2) return false;
    const tag = context.lookup(resolved.get(0));
    if (tag !== PDFName.of('ICCBased')) return false;
    const profile = context.lookup(resolved.get(1));
    if (!(profile instanceof PDFStream)) return false;
    const nObj = context.lookup(profile.dict.get(PDFName.of('N')));
    if (!(nObj instanceof PDFNumber)) return false;
    const n = nObj.asNumber();
    return n === 1 || n === 3;
  }
  return false;
}

export function shouldCompressImageStream(
  dict: PDFDict,
  byteLength: number,
  context: PDFContext
): boolean {
  if (byteLength < MIN_COMPRESS_BYTES) return false;
  if (context.lookup(dict.get(PDFName.of('Subtype'))) !== PDFName.of('Image')) return false;
  if (!isDctDecodeFilter(dict.get(PDFName.of('Filter')), context)) return false;
  if (dict.has(PDFName.of('Decode'))) return false;
  if (context.lookup(dict.get(PDFName.of('ImageMask'))) === PDFBool.True) return false;
  if (!isSupportedColorSpace(dict.get(PDFName.of('ColorSpace')), context)) return false;
  return true;
}

export async function browserJpegEncoder(
  jpegBytes: Uint8Array,
  maxSide: number,
  quality: number
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof Blob === 'undefined') {
      return null;
    }

    const copy = new Uint8Array(jpegBytes.byteLength);
    copy.set(jpegBytes);
    const inputBlob = new Blob([copy], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(inputBlob);

    try {
      const longSide = Math.max(bitmap.width, bitmap.height);
      if (longSide <= 0) return null;
      const scale = longSide > maxSide ? maxSide / longSide : 1;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      let outBlob: Blob | null = null;
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, width, height);
        outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, width, height);
        outBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality)
        );
      } else {
        return null;
      }

      if (!outBlob) return null;
      const buf = await outBlob.arrayBuffer();
      return { bytes: new Uint8Array(buf), width, height };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export async function compressImages(
  doc: PDFDocument,
  preset: CompressPreset,
  encode: Encoder = browserJpegEncoder
): Promise<CompressResult> {
  if (preset === 'off') {
    return { before: 0, after: 0, count: 0 };
  }

  // Ensure any lazily-embedded images (via doc.embedJpg) are materialized in doc.context.
  await doc.flush();

  const { maxSide, quality } = COMPRESS_PRESETS[preset];
  let before = 0;
  let after = 0;
  let count = 0;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (!shouldCompressImageStream(obj.dict, obj.contents.byteLength, doc.context)) continue;

    const origLen = obj.contents.byteLength;
    before += origLen;

    const encoded = await encode(obj.contents, maxSide, quality);
    if (!encoded || encoded.bytes.byteLength >= origLen * 0.9) {
      after += origLen;
      continue;
    }

    const newStream = doc.context.stream(encoded.bytes, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: encoded.width,
      Height: encoded.height,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
    });

    const smask = obj.dict.get(PDFName.of('SMask'));
    if (smask !== undefined) {
      newStream.dict.set(PDFName.of('SMask'), smask);
    }

    doc.context.assign(ref, newStream);
    after += encoded.bytes.byteLength;
    count += 1;
  }

  return { before, after, count };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}
