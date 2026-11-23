export type RangeParseResult =
  | { ok: true; parts: number[][] }
  | { ok: false; reason: 'empty' | 'invalid_token' | 'out_of_range'; token?: string };

/**
 * Parse comma-separated 1-based page ranges (e.g. "1-3, 5, 8-10")
 * into 0-based page index arrays per output part.
 */
export function parsePageRanges(input: string, totalPages: number): RangeParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  const rawTokens = trimmed.split(',').map((t) => t.trim());
  if (rawTokens.some((t) => t.length === 0)) {
    return { ok: false, reason: 'invalid_token', token: '' };
  }

  const parts: number[][] = [];

  for (const token of rawTokens) {
    const singleMatch = /^(\d+)$/.exec(token);
    if (singleMatch) {
      const pageNum = Number(singleMatch[1]);
      if (pageNum < 1 || pageNum > totalPages) {
        return { ok: false, reason: 'out_of_range', token };
      }
      parts.push([pageNum - 1]);
      continue;
    }

    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
        return { ok: false, reason: 'out_of_range', token };
      }
      if (start > end) {
        return { ok: false, reason: 'invalid_token', token };
      }
      const indices: number[] = [];
      for (let p = start; p <= end; p++) {
        indices.push(p - 1);
      }
      parts.push(indices);
      continue;
    }

    return { ok: false, reason: 'invalid_token', token };
  }

  return { ok: true, parts };
}

/**
 * Split `totalPages` into consecutive chunks of `n` pages (0-based indices).
 */
export function splitEveryN(n: number, totalPages: number): number[][] {
  if (!Number.isInteger(n) || n < 1 || totalPages < 1) {
    return [];
  }
  const parts: number[][] = [];
  for (let start = 0; start < totalPages; start += n) {
    const chunk: number[] = [];
    const end = Math.min(start + n, totalPages);
    for (let i = start; i < end; i++) {
      chunk.push(i);
    }
    parts.push(chunk);
  }
  return parts;
}
