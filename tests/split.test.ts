import { describe, expect, it } from 'vitest';
import { parsePageRanges, splitEveryN } from '../src/split.ts';

describe('parsePageRanges', () => {
  it('parses valid single pages and ranges', () => {
    expect(parsePageRanges('1-3, 5, 8-10', 10)).toEqual({
      ok: true,
      parts: [[0, 1, 2], [4], [7, 8, 9]],
    });
  });

  it('handles extra whitespace around commas and hyphens', () => {
    expect(parsePageRanges('  1 - 2 ,   4 , 6 - 6  ', 6)).toEqual({
      ok: true,
      parts: [[0, 1], [3], [5]],
    });
  });

  it('allows overlapping ranges into separate output parts', () => {
    expect(parsePageRanges('1-3, 2-4', 5)).toEqual({
      ok: true,
      parts: [
        [0, 1, 2],
        [1, 2, 3],
      ],
    });
  });

  it('rejects empty or whitespace-only input', () => {
    expect(parsePageRanges('', 5)).toEqual({ ok: false, reason: 'empty' });
    expect(parsePageRanges('   ', 5)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects out-of-range pages and ranges', () => {
    expect(parsePageRanges('0', 5)).toEqual({
      ok: false,
      reason: 'out_of_range',
      token: '0',
    });
    expect(parsePageRanges('1, 6', 5)).toEqual({
      ok: false,
      reason: 'out_of_range',
      token: '6',
    });
    expect(parsePageRanges('2-8', 5)).toEqual({
      ok: false,
      reason: 'out_of_range',
      token: '2-8',
    });
  });

  it('rejects invalid tokens and descending ranges', () => {
    expect(parsePageRanges('abc', 5)).toEqual({
      ok: false,
      reason: 'invalid_token',
      token: 'abc',
    });
    expect(parsePageRanges('4-2', 5)).toEqual({
      ok: false,
      reason: 'invalid_token',
      token: '4-2',
    });
    expect(parsePageRanges('1,,3', 5)).toEqual({
      ok: false,
      reason: 'invalid_token',
      token: '',
    });
    expect(parsePageRanges('1-', 5)).toEqual({
      ok: false,
      reason: 'invalid_token',
      token: '1-',
    });
  });
});

describe('splitEveryN', () => {
  it('splits evenly and with a remainder chunk', () => {
    expect(splitEveryN(2, 5)).toEqual([[0, 1], [2, 3], [4]]);
    expect(splitEveryN(3, 6)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
  });

  it('returns empty array for invalid inputs', () => {
    expect(splitEveryN(0, 5)).toEqual([]);
    expect(splitEveryN(2, 0)).toEqual([]);
  });
});
