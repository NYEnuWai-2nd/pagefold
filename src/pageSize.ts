export type FixedPaperMode = 'a3' | 'a4' | 'a5' | 'b4' | 'b5' | 'letter' | 'legal';
export type PageSizeMode = 'auto' | FixedPaperMode | 'original';

export const A3_SIZE: [number, number] = [841.89, 1190.55];
export const A4_SIZE: [number, number] = [595.28, 841.89];
export const A5_SIZE: [number, number] = [419.53, 595.28];
export const B4_SIZE: [number, number] = [728.5, 1031.81];
export const B5_SIZE: [number, number] = [515.91, 728.5];
export const LETTER_SIZE: [number, number] = [612, 792];
export const LEGAL_SIZE: [number, number] = [612, 1008];

const PAPER_SIZES: Record<FixedPaperMode, [number, number]> = {
  a3: A3_SIZE,
  a4: A4_SIZE,
  a5: A5_SIZE,
  b4: B4_SIZE,
  b5: B5_SIZE,
  letter: LETTER_SIZE,
  legal: LEGAL_SIZE,
};

export function isFixedPaper(mode: PageSizeMode): mode is FixedPaperMode {
  return Object.prototype.hasOwnProperty.call(PAPER_SIZES, mode);
}

export function isPageSizeMode(value: string): value is PageSizeMode {
  return (
    value === 'auto' ||
    value === 'original' ||
    Object.prototype.hasOwnProperty.call(PAPER_SIZES, value)
  );
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
  if (isFixedPaper(mode)) {
    return orientToMatch(PAPER_SIZES[mode], itemSize);
  }
  if (mode === 'original') {
    return [itemSize[0], itemSize[1]];
  }
  return orientToMatch(firstPdfSize ?? A4_SIZE, itemSize);
}
