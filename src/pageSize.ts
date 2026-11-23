export type PageSizeMode = 'auto' | 'a4' | 'letter' | 'original';

export const A4_SIZE: [number, number] = [595.28, 841.89];
export const LETTER_SIZE: [number, number] = [612, 792];

export function isPageSizeMode(value: string): value is PageSizeMode {
  return value === 'auto' || value === 'a4' || value === 'letter' || value === 'original';
}

function orientToMatch(base: [number, number], itemSize: [number, number]): [number, number] {
  const shortSide = Math.min(base[0], base[1]);
  const longSide = Math.max(base[0], base[1]);
  const isLandscape = itemSize[0] > itemSize[1];
  return isLandscape ? [longSide, shortSide] : [shortSide, longSide];
}

/**
 * Resolve the target PDF page size [width, height] in points.
 * `itemSize` is the item's unrotated size in points (for images: px * 0.75).
 */
export function resolvePageSize(
  mode: PageSizeMode,
  firstPdfSize: [number, number] | null,
  itemSize: [number, number]
): [number, number] {
  if (mode === 'a4') {
    return orientToMatch(A4_SIZE, itemSize);
  }
  if (mode === 'letter') {
    return orientToMatch(LETTER_SIZE, itemSize);
  }
  if (mode === 'original') {
    return [itemSize[0], itemSize[1]];
  }
  return orientToMatch(firstPdfSize ?? A4_SIZE, itemSize);
}
