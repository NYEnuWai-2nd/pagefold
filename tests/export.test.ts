import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  exportPagesToPdf,
  loadImageSource,
  loadPdfSource,
  type LoadedSource,
} from '../src/pdf.ts';
import {
  addSource,
  createInitialState,
  deleteSelected,
  reorderSelection,
  rotateSelected,
  selectOne,
} from '../src/state.ts';

describe('exportPagesToPdf', () => {
  it('applies reorder, rotate, delete and strips metadata by default', async () => {
    const srcDoc = await PDFDocument.create();
    srcDoc.setTitle('Secret Tax Return');
    srcDoc.setAuthor('Alice');
    srcDoc.addPage([200, 300]); // page 0
    const p1 = srcDoc.addPage([300, 400]); // page 1
    p1.setRotation(degrees(90));
    srcDoc.addPage([400, 500]); // page 2

    const srcBytes = await srcDoc.save();
    const loaded = await loadPdfSource('tax.pdf', srcBytes, { withPreview: false });

    const sourcesMap = new Map<string, LoadedSource>([['s1', loaded]]);
    const state = createInitialState();
    addSource(state, { id: 's1', name: 'tax.pdf', kind: 'pdf', pageCount: 3 });

    // Delete page 0
    selectOne(state, state.pages[0].uid);
    deleteSelected(state);

    // Rotate remaining page 1 (which already had 90 deg) by +90 => 180 deg
    selectOne(state, state.pages[0].uid);
    rotateSelected(state, 90);

    // Move page 2 (currently index 1) before page 1 (index 0)
    selectOne(state, state.pages[1].uid);
    reorderSelection(state, 0);

    const outBytes = await exportPagesToPdf(state.pages, sourcesMap, {
      stripMetadata: true,
    });
    const outDoc = await PDFDocument.load(outBytes);

    expect(outDoc.getPageCount()).toBe(2);
    // Page 2 is now first (width 400, rotation 0)
    expect(outDoc.getPage(0).getWidth()).toBe(400);
    expect(outDoc.getPage(0).getRotation().angle).toBe(0);
    // Page 1 is now second (width 300, rotation 90 + 90 = 180)
    expect(outDoc.getPage(1).getWidth()).toBe(300);
    expect(outDoc.getPage(1).getRotation().angle).toBe(180);

    // Metadata stripped
    expect(outDoc.getTitle()).toBeUndefined();
    expect(outDoc.getAuthor()).toBeUndefined();
  });

  it('preserves metadata from first source PDF when stripMetadata is false', async () => {
    const srcDoc = await PDFDocument.create();
    srcDoc.setTitle('Lease Agreement');
    srcDoc.setAuthor('Bob');
    srcDoc.addPage([200, 300]);

    const srcBytes = await srcDoc.save();
    const loaded = await loadPdfSource('lease.pdf', srcBytes, { withPreview: false });
    const sourcesMap = new Map<string, LoadedSource>([['s1', loaded]]);

    const state = createInitialState();
    addSource(state, { id: 's1', name: 'lease.pdf', kind: 'pdf', pageCount: 1 });

    const outBytes = await exportPagesToPdf(state.pages, sourcesMap, {
      stripMetadata: false,
    });
    const outDoc = await PDFDocument.load(outBytes);

    expect(outDoc.getTitle()).toBe('Lease Agreement');
    expect(outDoc.getAuthor()).toBe('Bob');
  });

  it('keeps order and normalized rotation across 2 sources in mixed order', async () => {
    const docA = await PDFDocument.create();
    docA.addPage([210, 300]); // A0
    const a1 = docA.addPage([220, 300]); // A1
    a1.setRotation(degrees(270));

    const docB = await PDFDocument.create();
    const b0 = docB.addPage([310, 400]); // B0
    b0.setRotation(degrees(90));
    docB.addPage([320, 400]); // B1

    const loadedA = await loadPdfSource('a.pdf', await docA.save(), { withPreview: false });
    const loadedB = await loadPdfSource('b.pdf', await docB.save(), { withPreview: false });
    const sourcesMap = new Map<string, LoadedSource>([
      ['a', loadedA],
      ['b', loadedB],
    ]);

    const pages = [
      { uid: '1', sourceId: 'a', pageIndex: 1, rotation: 180 as const }, // 270 + 180 = 450 -> 90
      { uid: '2', sourceId: 'b', pageIndex: 0, rotation: 270 as const }, // 90 + 270 = 360 -> 0
      { uid: '3', sourceId: 'a', pageIndex: 0, rotation: 90 as const },  // 0 + 90 -> 90
      { uid: '4', sourceId: 'b', pageIndex: 1, rotation: 0 as const },   // 0 -> 0
    ];

    const outBytes = await exportPagesToPdf(pages, sourcesMap, { stripMetadata: true });
    const outDoc = await PDFDocument.load(outBytes);

    expect(outDoc.getPageCount()).toBe(4);
    expect([0, 1, 2, 3].map((i) => outDoc.getPage(i).getWidth())).toEqual([220, 310, 210, 320]);
    expect([0, 1, 2, 3].map((i) => outDoc.getPage(i).getRotation().angle)).toEqual([90, 0, 90, 0]);
  });

  it('does not bloat output when exporting N pages from one source', async () => {
    const srcDoc = await PDFDocument.create();
    const font = await srcDoc.embedFont(StandardFonts.Helvetica);
    const pageCount = 20;
    for (let i = 0; i < pageCount; i++) {
      const p = srcDoc.addPage([595, 842]);
      p.drawText(`Page ${i + 1} - shared font test`, { x: 50, y: 780, size: 16, font });
    }
    const srcBytes = await srcDoc.save();
    const loaded = await loadPdfSource('multi.pdf', srcBytes, { withPreview: false });
    const sourcesMap = new Map<string, LoadedSource>([['s1', loaded]]);

    const state = createInitialState();
    addSource(state, { id: 's1', name: 'multi.pdf', kind: 'pdf', pageCount });

    const outBytes = await exportPagesToPdf(state.pages, sourcesMap, { stripMetadata: true });
    expect(outBytes.byteLength).toBeLessThan(srcBytes.byteLength * 2);
  });

  it('normalizes A4 PDF + 1000x500 PNG in auto mode to A4 portrait and A4 landscape', async () => {
    const srcDoc = await PDFDocument.create();
    srcDoc.addPage([595.28, 841.89]); // A4 portrait
    const loadedPdf = await loadPdfSource('a4.pdf', await srcDoc.save(), { withPreview: false });

    const pngBytes = createSolidPng(1000, 500);
    const loadedImg = loadImageSource('wide.png', 'image/png', pngBytes, { withPreview: false });

    const sourcesMap = new Map<string, LoadedSource>([
      ['p', loadedPdf],
      ['i', loadedImg],
    ]);

    const pages = [
      { uid: '1', sourceId: 'p', pageIndex: 0, rotation: 0 as const },
      { uid: '2', sourceId: 'i', pageIndex: 0, rotation: 0 as const },
    ];

    const outBytes = await exportPagesToPdf(pages, sourcesMap, {
      stripMetadata: true,
      pageSize: 'auto',
    });
    const outDoc = await PDFDocument.load(outBytes);
    expect(outDoc.getPageCount()).toBe(2);

    expect(outDoc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(outDoc.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
    expect(outDoc.getPage(1).getWidth()).toBeCloseTo(841.89, 1);
    expect(outDoc.getPage(1).getHeight()).toBeCloseTo(595.28, 1);
  });

  it('normalizes all PDF and image pages to Letter in letter mode while preserving rotation', async () => {
    const srcDoc = await PDFDocument.create();
    const p0 = srcDoc.addPage([595.28, 841.89]);
    p0.setRotation(degrees(90));
    const loadedPdf = await loadPdfSource('a4.pdf', await srcDoc.save(), { withPreview: false });

    const pngBytes = createSolidPng(1000, 500);
    const loadedImg = loadImageSource('wide.png', 'image/png', pngBytes, { withPreview: false });

    const sourcesMap = new Map<string, LoadedSource>([
      ['p', loadedPdf],
      ['i', loadedImg],
    ]);

    const pages = [
      { uid: '1', sourceId: 'p', pageIndex: 0, rotation: 0 as const },
      { uid: '2', sourceId: 'i', pageIndex: 0, rotation: 0 as const },
    ];

    const outBytes = await exportPagesToPdf(pages, sourcesMap, {
      stripMetadata: true,
      pageSize: 'letter',
    });
    const outDoc = await PDFDocument.load(outBytes);
    expect(outDoc.getPageCount()).toBe(2);

    expect(outDoc.getPage(0).getWidth()).toBeCloseTo(612, 1);
    expect(outDoc.getPage(0).getHeight()).toBeCloseTo(792, 1);
    expect(outDoc.getPage(0).getRotation().angle).toBe(90);

    expect(outDoc.getPage(1).getWidth()).toBeCloseTo(792, 1);
    expect(outDoc.getPage(1).getHeight()).toBeCloseTo(612, 1);
  });
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function createSolidPng(width: number, height: number): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 0; // grayscale

  const raw = new Uint8Array(height * (width + 1));
  const idatData = deflateSync(raw);

  const ihdr = makePngChunk('IHDR', ihdrData);
  const idat = makePngChunk('IDAT', idatData);
  const iend = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  for (const part of [sig, ihdr, idat, iend]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
