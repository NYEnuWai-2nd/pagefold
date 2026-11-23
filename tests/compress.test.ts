import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFBool, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  COMPRESS_PRESETS,
  compressImages,
  formatBytes,
  isCompressPreset,
  shouldCompressImageStream,
  type Encoder,
} from '../src/compress.ts';
import { exportPagesToPdf, loadImageSource, loadPdfSource, type LoadedSource } from '../src/pdf.ts';
import { addSource, createInitialState } from '../src/state.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bigJpg = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/big.jpg')));
const smallJpg = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/small.jpg')));

describe('isCompressPreset & formatBytes', () => {
  it('validates compress presets', () => {
    expect(isCompressPreset('off')).toBe(true);
    expect(isCompressPreset('light')).toBe(true);
    expect(isCompressPreset('standard')).toBe(true);
    expect(isCompressPreset('strong')).toBe(true);
    expect(isCompressPreset('ultra')).toBe(false);
  });

  it('formats byte counts cleanly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(14.2 * 1024 * 1024)).toBe('14.2 MB');
  });
});

describe('shouldCompressImageStream', () => {
  const BIG_LEN = 120 * 1024;

  function makeImageDict(doc: PDFDocument, entries: Record<string, unknown>) {
    return doc.context.obj({
      Type: 'XObject',
      Subtype: 'Image',
      Filter: 'DCTDecode',
      ColorSpace: 'DeviceRGB',
      ...entries,
    });
  }

  it('allows >=100KB DCTDecode DeviceRGB and DeviceGray images', async () => {
    const doc = await PDFDocument.create();
    const rgbDict = makeImageDict(doc, {});
    const grayDict = makeImageDict(doc, { ColorSpace: 'DeviceGray' });
    const arrayFilterDict = makeImageDict(doc, { Filter: [PDFName.of('DCTDecode')] });

    expect(shouldCompressImageStream(rgbDict, BIG_LEN, doc.context)).toBe(true);
    expect(shouldCompressImageStream(grayDict, BIG_LEN, doc.context)).toBe(true);
    expect(shouldCompressImageStream(arrayFilterDict, BIG_LEN, doc.context)).toBe(true);
  });

  it('skips images smaller than 100 KB', async () => {
    const doc = await PDFDocument.create();
    const dict = makeImageDict(doc, {});
    expect(shouldCompressImageStream(dict, 99 * 1024, doc.context)).toBe(false);
  });

  it('skips DeviceCMYK and unsupported ColorSpaces', async () => {
    const doc = await PDFDocument.create();
    expect(
      shouldCompressImageStream(
        makeImageDict(doc, { ColorSpace: 'DeviceCMYK' }),
        BIG_LEN,
        doc.context
      )
    ).toBe(false);
    expect(
      shouldCompressImageStream(
        makeImageDict(doc, { ColorSpace: 'Indexed' }),
        BIG_LEN,
        doc.context
      )
    ).toBe(false);
  });

  it('checks ICCBased N=1, N=3 vs N=4', async () => {
    const doc = await PDFDocument.create();
    const makeIcc = (n: number) => {
      const profileStream = doc.context.stream(new Uint8Array([0]), { N: n });
      const profileRef = doc.context.register(profileStream);
      const cs = PDFArray.withContext(doc.context);
      cs.push(PDFName.of('ICCBased'));
      cs.push(profileRef);
      return makeImageDict(doc, { ColorSpace: cs });
    };

    expect(shouldCompressImageStream(makeIcc(1), BIG_LEN, doc.context)).toBe(true);
    expect(shouldCompressImageStream(makeIcc(3), BIG_LEN, doc.context)).toBe(true);
    expect(shouldCompressImageStream(makeIcc(4), BIG_LEN, doc.context)).toBe(false);
  });

  it('skips /Decode, /ImageMask true, and non-DCTDecode filters', async () => {
    const doc = await PDFDocument.create();
    expect(
      shouldCompressImageStream(
        makeImageDict(doc, { Decode: [PDFNumber.of(1), PDFNumber.of(0)] }),
        BIG_LEN,
        doc.context
      )
    ).toBe(false);
    expect(
      shouldCompressImageStream(
        makeImageDict(doc, { ImageMask: PDFBool.True }),
        BIG_LEN,
        doc.context
      )
    ).toBe(false);
    expect(
      shouldCompressImageStream(
        makeImageDict(doc, { Filter: 'FlateDecode' }),
        BIG_LEN,
        doc.context
      )
    ).toBe(false);
  });
});

describe('compressImages', () => {
  it('compresses a >=100KB embedded JPEG, preserves SMask, drops DecodeParms, and reloads cleanly', async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(bigJpg);
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    await doc.flush();

    // Attach an SMask and DecodeParms to the embedded image stream to verify preservation/dropping
    const smaskRef = doc.context.register(
      doc.context.stream(new Uint8Array([1, 2, 3]), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 4,
        Height: 4,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
      })
    );
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
        obj.dict.set(PDFName.of('SMask'), smaskRef);
        obj.dict.set(PDFName.of('DecodeParms'), doc.context.obj({ ColorTransform: 1 }));
      }
    }

    const uncompressedBytes = await doc.save();

    const fakeEncoder: Encoder = vi.fn(async (_bytes, maxSide, quality) => {
      expect(maxSide).toBe(COMPRESS_PRESETS.standard.maxSide);
      expect(quality).toBe(COMPRESS_PRESETS.standard.quality);
      return { bytes: smallJpg, width: 16, height: 16 };
    });

    const res = await compressImages(doc, 'standard', fakeEncoder);
    expect(res.count).toBe(1);
    expect(res.before).toBeGreaterThanOrEqual(100 * 1024);
    expect(res.after).toBe(smallJpg.byteLength);
    expect(fakeEncoder).toHaveBeenCalledTimes(1);

    const compressedBytes = await doc.save();
    expect(compressedBytes.byteLength).toBeLessThan(uncompressedBytes.byteLength);

    const reloaded = await PDFDocument.load(compressedBytes);
    expect(reloaded.getPageCount()).toBe(1);

    // Verify SMask preserved and DecodeParms dropped on the compressed image
    let foundImage = false;
    for (const [, obj] of reloaded.context.enumerateIndirectObjects()) {
      if (
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') &&
        obj.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode')
      ) {
        foundImage = true;
        expect(obj.dict.get(PDFName.of('SMask'))).toBeDefined();
        expect(obj.dict.has(PDFName.of('DecodeParms'))).toBe(false);
        expect((obj.dict.get(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(16);
      }
    }
    expect(foundImage).toBe(true);
  });

  it('keeps original when encoder returns null or >= 90% of original size', async () => {
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(bigJpg);
    doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });

    const nullRes = await compressImages(doc, 'strong', async () => null);
    expect(nullRes.count).toBe(0);
    expect(nullRes.after).toBe(nullRes.before);

    const largeEnough = new Uint8Array(Math.ceil(bigJpg.byteLength * 0.91));
    const bigRes = await compressImages(doc, 'strong', async () => ({
      bytes: largeEnough,
      width: 100,
      height: 100,
    }));
    expect(bigRes.count).toBe(0);
    expect(bigRes.after).toBe(bigRes.before);
  });

  it('hooks into exportPagesToPdf when compress !== off', async () => {
    const srcDoc = await PDFDocument.create();
    const img = await srcDoc.embedJpg(bigJpg);
    srcDoc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    const srcPdfBytes = await srcDoc.save();

    const loadedPdf = await loadPdfSource('scan.pdf', srcPdfBytes, { withPreview: false });
    const loadedImg = loadImageSource('photo.jpg', 'image/jpeg', bigJpg, { withPreview: false });

    const state = createInitialState();
    const sources = new Map<string, LoadedSource>();
    addSource(state, { id: 'src-1', name: loadedPdf.name, kind: 'pdf', pageCount: loadedPdf.pageCount });
    sources.set('src-1', loadedPdf);
    addSource(state, { id: 'src-2', name: loadedImg.name, kind: 'image', pageCount: loadedImg.pageCount });
    sources.set('src-2', loadedImg);

    const fakeEncoder: Encoder = vi.fn(async () => ({
      bytes: smallJpg,
      width: 16,
      height: 16,
    }));

    const outOff = await exportPagesToPdf(state.pages, sources, {
      stripMetadata: true,
      compress: 'off',
      compressEncoder: fakeEncoder,
    });
    expect(fakeEncoder).not.toHaveBeenCalled();

    const outLight = await exportPagesToPdf(state.pages, sources, {
      stripMetadata: true,
      compress: 'light',
      compressEncoder: fakeEncoder,
    });
    expect(fakeEncoder).toHaveBeenCalledTimes(2);
    expect(outLight.byteLength).toBeLessThan(outOff.byteLength);

    const reloaded = await PDFDocument.load(outLight);
    expect(reloaded.getPageCount()).toBe(2);
  });
});
