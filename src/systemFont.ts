import { readFile } from '@tauri-apps/plugin-fs';

export type PlatformKind = 'windows' | 'macos' | 'linux';

export interface SystemFont {
  bytes: Uint8Array;
  name: string;
}

const CANDIDATE_PATHS: Record<PlatformKind, readonly string[]> = {
  windows: [
    'C:\\Windows\\Fonts\\YuGothR.ttc',
    'C:\\Windows\\Fonts\\YuGothM.ttc',
    'C:\\Windows\\Fonts\\BIZ-UDGothicR.ttc',
    'C:\\Windows\\Fonts\\meiryo.ttc',
    'C:\\Windows\\Fonts\\msgothic.ttc',
  ],
  macos: [
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  ],
  linux: [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
  ],
};

export function detectPlatform(userAgent?: string): PlatformKind {
  const ua =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const lower = ua.toLowerCase();
  if (lower.includes('win')) return 'windows';
  if (lower.includes('mac')) return 'macos';
  return 'linux';
}

export function getCandidateFontPaths(platform: PlatformKind = detectPlatform()): readonly string[] {
  return CANDIDATE_PATHS[platform];
}

function isTtcHeader(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x74 && // 't'
    bytes[1] === 0x74 && // 't'
    bytes[2] === 0x63 && // 'c'
    bytes[3] === 0x66    // 'f'
  );
}

/**
 * Extract a single standalone sfnt (TTF/OTF) from a TrueType Collection (.ttc).
 * If `bytes` does not start with 'ttcf', returns `bytes` unchanged.
 */
export function extractTtcFace(bytes: Uint8Array, index = 0): Uint8Array {
  if (!isTtcHeader(bytes)) {
    return bytes;
  }
  if (bytes.byteLength < 12) {
    throw new Error('Truncated TTC header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numFonts = view.getUint32(8, false);
  if (index < 0 || index >= numFonts) {
    throw new Error(`TTC font index ${index} out of range (0..${numFonts - 1})`);
  }
  if (bytes.byteLength < 12 + (index + 1) * 4) {
    throw new Error('Truncated TTC offset table');
  }

  const faceOffset = view.getUint32(12 + index * 4, false);
  if (faceOffset + 12 > bytes.byteLength) {
    throw new Error('Truncated sfnt header in TTC');
  }

  const numTables = view.getUint16(faceOffset + 4, false);
  const dirStart = faceOffset + 12;
  const dirEnd = dirStart + numTables * 16;
  if (dirEnd > bytes.byteLength) {
    throw new Error('Truncated sfnt table directory in TTC');
  }

  const headerSize = 12 + numTables * 16;
  let totalTableBytes = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = dirStart + i * 16;
    const tableOffset = view.getUint32(rec + 8, false);
    const tableLength = view.getUint32(rec + 12, false);
    if (tableOffset + tableLength > bytes.byteLength) {
      throw new Error('Truncated table data in TTC');
    }
    totalTableBytes += (tableLength + 3) & ~3;
  }

  const out = new Uint8Array(headerSize + totalTableBytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // Copy sfntVersion
  out.set(bytes.subarray(faceOffset, faceOffset + 4), 0);
  outView.setUint16(4, numTables, false);

  let entrySelector = 0;
  let maxPow2 = 1;
  while (maxPow2 * 2 <= numTables) {
    maxPow2 *= 2;
    entrySelector++;
  }
  const searchRange = numTables === 0 ? 0 : maxPow2 * 16;
  const rangeShift = numTables * 16 - searchRange;
  outView.setUint16(6, searchRange, false);
  outView.setUint16(8, entrySelector, false);
  outView.setUint16(10, rangeShift, false);

  let writeOffset = headerSize;
  for (let i = 0; i < numTables; i++) {
    const inRec = dirStart + i * 16;
    const outRec = 12 + i * 16;

    // Copy tag (4 bytes) and checksum (4 bytes)
    out.set(bytes.subarray(inRec, inRec + 8), outRec);

    const tableOffset = view.getUint32(inRec + 8, false);
    const tableLength = view.getUint32(inRec + 12, false);

    outView.setUint32(outRec + 8, writeOffset, false);
    outView.setUint32(outRec + 12, tableLength, false);

    out.set(bytes.subarray(tableOffset, tableOffset + tableLength), writeOffset);
    writeOffset += (tableLength + 3) & ~3;
  }

  return out;
}

/**
 * Check whether an sfnt font is safe to embed & subset with pdf-lib:
 * - Rejects CFF/OpenType ('OTTO') because pdf-lib subsetting of CFF CJK is unreliable.
 * - Rejects fonts with OS/2 fsType restricted license bit (0x0002) without preview/print (0x0004) or editable (0x0008).
 */
export function isEmbeddable(sfnt: Uint8Array): boolean {
  if (sfnt.byteLength < 12) return false;

  // Reject 'OTTO' (CFF OpenType)
  if (
    sfnt[0] === 0x4f && // 'O'
    sfnt[1] === 0x54 && // 'T'
    sfnt[2] === 0x54 && // 'T'
    sfnt[3] === 0x4f    // 'O'
  ) {
    return false;
  }

  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = view.getUint16(4, false);
  if (12 + numTables * 16 > sfnt.byteLength) return false;

  const OS2_TAG = 0x4f532f32; // 'OS/2'
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (view.getUint32(rec, false) === OS2_TAG) {
      const tableOffset = view.getUint32(rec + 8, false);
      const tableLength = view.getUint32(rec + 12, false);
      if (tableLength < 10 || tableOffset + 10 > sfnt.byteLength) {
        return false;
      }
      const fsType = view.getUint16(tableOffset + 8, false);
      if ((fsType & 0x0002) !== 0 && (fsType & 0x000c) === 0) {
        return false;
      }
      return true;
    }
  }

  return true;
}

function basename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

let cachedFontPromise: Promise<SystemFont | null> | null = null;

/**
 * Load the first available, embeddable OS-installed Japanese-capable font.
 * Cached for the lifetime of the session (including `null` if none found).
 */
export function loadSystemFont(): Promise<SystemFont | null> {
  if (cachedFontPromise) {
    return cachedFontPromise;
  }

  cachedFontPromise = (async () => {
    const candidates = getCandidateFontPaths();
    for (const fontPath of candidates) {
      try {
        const raw = await readFile(fontPath);
        const sfnt = extractTtcFace(raw, 0);
        if (!isEmbeddable(sfnt)) continue;
        return { bytes: sfnt, name: basename(fontPath) };
      } catch {
        // Skip unreadable or invalid font candidate
      }
    }
    return null;
  })();

  return cachedFontPromise;
}
