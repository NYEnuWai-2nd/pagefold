import { describe, expect, it } from 'vitest';
import { A4_SIZE, LETTER_SIZE, resolvePageSize } from '../src/pageSize.ts';

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

  it('returns itemSize unchanged in original mode', () => {
    expect(resolvePageSize('original', A4_SIZE, [750, 375])).toEqual([750, 375]);
  });
});
