import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { exportPagesToPdf, loadPdfSource, type LoadedSource } from '../src/pdf.ts';
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
});
