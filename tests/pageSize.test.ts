import { describe, expect, it } from 'vitest';
import {
  A3_SIZE,
  A4_SIZE,
  A5_SIZE,
  B4_SIZE,
  B5_SIZE,
  LEGAL_SIZE,
  LETTER_SIZE,
  isFixedPaper,
  isPageSizeMode,
  resolvePageSize,
} from '../src/pageSize.ts';

describe('isPageSizeMode / isFixedPaper', () => {
  it('recognizes all supported modes and rejects invalid ones', () => {
    for (const mode of ['auto', 'a3', 'a4', 'a5', 'b4', 'b5', 'letter', 'legal', 'original'] as const) {
      expect(isPageSizeMode(mode)).toBe(true);
    }
    expect(isPageSizeMode('tabloid')).toBe(false);
    expect(isPageSizeMode('toString')).toBe(false);

    expect(isFixedPaper('auto')).toBe(false);
    expect(isFixedPaper('original')).toBe(false);
    expect(isFixedPaper('a3')).toBe(true);
    expect(isFixedPaper('b5')).toBe(true);
    expect(isFixedPaper('legal')).toBe(true);
  });
});

describe('resolvePageSize', () => {
  it('matches first PDF page size and flips orientation for landscape image in auto mode', () => {
    const size = resolvePageSize('auto', A4_SIZE, [750, 375]);
    expect(size).toEqual([A4_SIZE[1], A4_SIZE[0]]);
  });

  it('matches first PDF page size in portrait when image is portrait in auto mode', () => {
    const size = resolvePageSize('auto', [612, 792], [300, 600]);
    expect(size).toEqual([612, 792]);
  });

  it('falls back to A4 when there is no PDF page in auto mode', () => {
    expect(resolvePageSize('auto', null, [400, 600])).toEqual(A4_SIZE);
    expect(resolvePageSize('auto', null, [800, 400])).toEqual([A4_SIZE[1], A4_SIZE[0]]);
  });

  it('uses Letter size oriented per item in letter mode', () => {
    expect(resolvePageSize('letter', A4_SIZE, [400, 600])).toEqual(LETTER_SIZE);
    expect(resolvePageSize('letter', A4_SIZE, [800, 400])).toEqual([
      LETTER_SIZE[1],
      LETTER_SIZE[0],
    ]);
  });

  it('uses A4 size oriented per item in a4 mode', () => {
    expect(resolvePageSize('a4', LETTER_SIZE, [400, 600])).toEqual(A4_SIZE);
    expect(resolvePageSize('a4', LETTER_SIZE, [800, 400])).toEqual([A4_SIZE[1], A4_SIZE[0]]);
  });

  it('uses JIS B5 size oriented per item in b5 mode', () => {
    expect(resolvePageSize('b5', A4_SIZE, [400, 600])).toEqual([515.91, 728.5]);
    expect(resolvePageSize('b5', A4_SIZE, [800, 400])).toEqual([728.5, 515.91]);
  });

  it('uses A3, A5, JIS B4, and Legal sizes oriented per item', () => {
    expect(resolvePageSize('a3', A4_SIZE, [400, 600])).toEqual(A3_SIZE);
    expect(resolvePageSize('a3', A4_SIZE, [800, 400])).toEqual([A3_SIZE[1], A3_SIZE[0]]);
    expect(resolvePageSize('a5', A4_SIZE, [400, 600])).toEqual(A5_SIZE);
    expect(resolvePageSize('b4', A4_SIZE, [400, 600])).toEqual(B4_SIZE);
    expect(resolvePageSize('legal', A4_SIZE, [400, 600])).toEqual(LEGAL_SIZE);
  });

  it('returns itemSize unchanged in original mode', () => {
    expect(resolvePageSize('original', A4_SIZE, [750, 375])).toEqual([750, 375]);
  });
});
