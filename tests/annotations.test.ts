import { describe, expect, it } from 'vitest';
import { toPageCoords, toPageRect, toViewCoords, toViewRect } from '../src/annotations.ts';
import type { Rotation } from '../src/state.ts';

describe('annotation coordinate mapping', () => {
  const rotations: Rotation[] = [0, 90, 180, 270];

  it.each(rotations)('round-trips points for rotation %i°', (rot) => {
    const pts = [
      { x: 0.15, y: 0.35 },
      { x: 0.8, y: 0.2 },
      { x: 0, y: 1 },
    ];
    for (const pt of pts) {
      const view = toViewCoords(pt, rot);
      const back = toPageCoords(view, rot);
      expect(back.x).toBeCloseTo(pt.x, 6);
      expect(back.y).toBeCloseTo(pt.y, 6);
    }
  });

  it.each(rotations)('round-trips rects for rotation %i°', (rot) => {
    const rect = { x: 0.1, y: 0.2, w: 0.35, h: 0.45 };
    const view = toViewRect(rect, rot);
    const back = toPageRect(view, rot);
    expect(back.x).toBeCloseTo(rect.x, 6);
    expect(back.y).toBeCloseTo(rect.y, 6);
    expect(back.w).toBeCloseTo(rect.w, 6);
    expect(back.h).toBeCloseTo(rect.h, 6);
  });

  it('maps known corners for 90° rotation', () => {
    // Unrotated top-left (0,0) moves to top-right (1,0) at 90° CW
    expect(toViewCoords({ x: 0, y: 0 }, 90)).toEqual({ x: 1, y: 0 });
    expect(toPageCoords({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 0 });
  });
});
