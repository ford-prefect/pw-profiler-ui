/* Half-open range of cycle indices. */
export interface Range {
  start: number;
  end: number;
}

export function clampRange(r: Range | undefined, n: number): Range {
  if (!r) return { start: 0, end: n };
  const start = Math.max(0, Math.min(n, Math.floor(r.start)));
  return { start, end: Math.max(start, Math.min(n, Math.ceil(r.end))) };
}
