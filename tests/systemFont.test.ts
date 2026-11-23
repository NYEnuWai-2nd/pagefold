import { existsSync, readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractTtcFace, isEmbeddable } from '../src/systemFont.ts';

function encodeTag(tag: string): number {
  return (
    ((tag.charCodeAt(0) & 0xff) << 24) |
    ((tag.charCodeAt(1) & 0xff) << 16) |
    ((tag.charCodeAt(2) & 0xff) << 8) |
    (tag.charCodeAt(3) & 0xff)
  ) >>> 0;
}

interface SyntheticTable {
  tag: string;
  checksum: number;
  data: Uint8Array;
}

function buildSyntheticSfnt(sfntVersion: number, tables: SyntheticTable[]): Uint8Array {
  const headerSize = 12 + tables.length * 16;
  let dataSize = 0;
  for (const t of tables) {
    dataSize += (t.data.length + 3) & ~3;
  }

  const out = new Uint8Array(headerSize + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, sfntVersion, false);
  view.setUint16(4, tables.length, false);
  let entrySelector = 0;
  let maxPow2 = 1;
  while (maxPow2 * 2 <= tables.length) {
    maxPow2 *= 2;
    entrySelector++;
  }
  const searchRange = tables.length === 0 ? 0 : maxPow2 * 16;
  const rangeShift = tables.length * 16 - searchRange;
  view.setUint16(6, searchRange, false);
  view.setUint16(8, entrySelector, false);
  view.setUint16(10, rangeShift, false);

  let writeOffset = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    view.setUint32(rec, encodeTag(t.tag), false);
    view.setUint32(rec + 4, t.checksum, false);
    view.setUint32(rec + 8, writeOffset, false);
    view.setUint32(rec + 12, t.data.length, false);
    out.set(t.data, writeOffset);
    writeOffset += (t.data.length + 3) & ~3;
  });

  return out;
}

function buildSyntheticTtc(
  faces: Array<{ sfntVersion: number; tables: SyntheticTable[] }>
): Uint8Array {
  // TTC header: 'ttcf' (4) + version 1.0 (4) + numFonts (4) + offsetTable (4 * N)
  const ttcHeaderSize = 12 + faces.length * 4;
  const faceHeaderSizes = faces.map((f) => 12 + f.tables.length * 16);
  const faceOffsets: number[] = [];
  let cursor = ttcHeaderSize;
  for (const h of faceHeaderSizes) {
    faceOffsets.push(cursor);
    cursor += h;
  }

  const tableOffsetsByFace: number[][] = [];
  for (const f of faces) {
    const offsets: number[] = [];
    for (const t of f.tables) {
      offsets.push(cursor);
      cursor += (t.data.length + 3) & ~3;
    }
    tableOffsetsByFace.push(offsets);
  }

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  view.setUint32(0, encodeTag('ttcf'), false);
  view.setUint16(4, 1, false);
  view.setUint16(6, 0, false);
  view.setUint32(8, faces.length, false);

  faces.forEach((f, faceIdx) => {
    const faceOffset = faceOffsets[faceIdx];
    view.setUint32(12 + faceIdx * 4, faceOffset, false);

    view.setUint32(faceOffset, f.sfntVersion, false);
    view.setUint16(faceOffset + 4, f.tables.length, false);
    // Intentionally leave searchRange/entrySelector/rangeShift as 0 in TTC to verify recomputation
    f.tables.forEach((t, tblIdx) => {
      const rec = faceOffset + 12 + tblIdx * 16;
      const tblOffset = tableOffsetsByFace[faceIdx][tblIdx];
      view.setUint32(rec, encodeTag(t.tag), false);
      view.setUint32(rec + 4, t.checksum, false);
      view.setUint32(rec + 8, tblOffset, false);
      view.setUint32(rec + 12, t.data.length, false);
      out.set(t.data, tblOffset);
    });
  });

  return out;
}

describe('extractTtcFace', () => {
  it('returns non-TTC bytes unchanged', () => {
    const sfnt = buildSyntheticSfnt(0x00010000, [
      { tag: 'head', checksum: 0x11223344, data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    expect(extractTtcFace(sfnt, 0)).toBe(sfnt);
  });

  it('extracts standalone sfnt faces from a synthetic 2-face TTC byte-equally', () => {
    const face0Tables: SyntheticTable[] = [
      { tag: 'OS/2', checksum: 0xaaaaaaaa, data: new Uint8Array(10).fill(0) },
      { tag: 'head', checksum: 0x12345678, data: new Uint8Array([9, 8, 7, 6, 5]) }, // unaligned length 5
      { tag: 'name', checksum: 0xdeadbeef, data: new Uint8Array([10, 20, 30, 40]) },
    ];
    const face1Tables: SyntheticTable[] = [
      { tag: 'head', checksum: 0x01020304, data: new Uint8Array([42, 43, 44]) },
    ];

    const ttc = buildSyntheticTtc([
      { sfntVersion: 0x00010000, tables: face0Tables },
      { sfntVersion: 0x00010000, tables: face1Tables },
    ]);

    const extracted0 = extractTtcFace(ttc, 0);
    const expected0 = buildSyntheticSfnt(0x00010000, face0Tables);
    expect(extracted0).toEqual(expected0);

    const extracted1 = extractTtcFace(ttc, 1);
    const expected1 = buildSyntheticSfnt(0x00010000, face1Tables);
    expect(extracted1).toEqual(expected1);
  });
});

describe('isEmbeddable', () => {
  function makeSfntWithFsType(fsType: number, sfntVersion = 0x00010000): Uint8Array {
    const os2 = new Uint8Array(10);
    new DataView(os2.buffer).setUint16(8, fsType, false);
    return buildSyntheticSfnt(sfntVersion, [{ tag: 'OS/2', checksum: 0, data: os2 }]);
  }

  it('allows installable (0x0000), preview/print (0x0004), and editable (0x0008)', () => {
    expect(isEmbeddable(makeSfntWithFsType(0x0000))).toBe(true);
    expect(isEmbeddable(makeSfntWithFsType(0x0004))).toBe(true);
    expect(isEmbeddable(makeSfntWithFsType(0x0008))).toBe(true);
    expect(isEmbeddable(makeSfntWithFsType(0x0006))).toBe(true);
  });

  it('rejects restricted license (0x0002) without preview/print or editable bits', () => {
    expect(isEmbeddable(makeSfntWithFsType(0x0002))).toBe(false);
  });

  it('rejects CFF OpenType (OTTO)', () => {
    expect(isEmbeddable(makeSfntWithFsType(0x0000, encodeTag('OTTO')))).toBe(false);
  });
});

const windowsFontCandidates = [
  'C:\\Windows\\Fonts\\YuGothR.ttc',
  'C:\\Windows\\Fonts\\msgothic.ttc',
];
const existingWindowsFont = windowsFontCandidates.find((p) => existsSync(p));

describe('Windows system font integration', () => {
  it.skipIf(!existingWindowsFont)(
    'extracts face 0, embeds subset with pdf-lib + fontkit, draws Japanese text, and stays under 1 MB',
    async () => {
      const raw = new Uint8Array(readFileSync(existingWindowsFont!));
      const sfnt = extractTtcFace(raw, 0);
      expect(isEmbeddable(sfnt)).toBe(true);

      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const font = await doc.embedFont(sfnt, { subset: true });
      const page = doc.addPage([595.28, 841.89]);
      page.drawText('こんにちは Pagefold', {
        x: 50,
        y: 750,
        size: 18,
        font,
        color: rgb(0, 0, 0),
      });

      const saved = await doc.save();
      expect(saved.byteLength).toBeLessThan(1024 * 1024);

      const reloaded = await PDFDocument.load(saved);
      expect(reloaded.getPageCount()).toBe(1);
    }
  );
});
