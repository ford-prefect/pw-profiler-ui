import { clampRange, type Range } from './range';

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  sum: number;
  p50: number;
  p90: number;
  p99: number;
  p999: number;
}

type Values = ArrayLike<number>;

/* Finite values in range, sorted ascending. */
export function sorted(values: Values, range?: Range): Float64Array {
  const { start, end } = clampRange(range, values.length);
  const out = new Float64Array(end - start);
  let k = 0;
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (Number.isFinite(v)) out[k++] = v;
  }
  return out.subarray(0, k).sort();
}

/* Linearly interpolated quantile of sorted values. */
export function quantile(s: Values, q: number): number {
  if (!s.length) return NaN;
  const x = q * (s.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (x - lo);
}

export function summarize(values: Values, range?: Range): Summary {
  const s = sorted(values, range);
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i];
  return {
    n: s.length,
    min: s.length ? s[0] : NaN,
    max: s.length ? s[s.length - 1] : NaN,
    mean: s.length ? sum / s.length : NaN,
    sum,
    p50: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    p99: quantile(s, 0.99),
    p999: quantile(s, 0.999),
  };
}

export interface Histogram {
  /* bins + 1 edges; bin i covers [edges[i], edges[i + 1]). */
  edges: Float64Array;
  counts: Uint32Array;
}

/* Values outside [min, max] go into the first or last bin. */
export function histogram(
  values: Values,
  opts: { bins: number; min: number; max: number; range?: Range },
): Histogram {
  const { bins, min, max } = opts;
  const { start, end } = clampRange(opts.range, values.length);
  const edges = new Float64Array(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = min + ((max - min) * i) / bins;
  const counts = new Uint32Array(bins);
  const scale = bins / (max - min);
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const b = Math.floor((v - min) * scale);
    counts[b < 0 ? 0 : b >= bins ? bins - 1 : b]++;
  }
  return { edges, counts };
}
