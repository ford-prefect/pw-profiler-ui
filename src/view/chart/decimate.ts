export interface Decimated {
  x: Float64Array;
  ys: Float64Array[];
  /* Source index of each output point, following the first series. */
  index: Uint32Array;
}

/*
 * Min/max decimation over [start, end) into at most 2 * buckets points, so
 * spikes survive at any zoom level. NaN values are skipped.
 */
export function decimate(
  x: ArrayLike<number>,
  ys: ArrayLike<number>[],
  start: number,
  end: number,
  buckets: number,
): Decimated {
  const n = Math.max(0, end - start);
  if (n <= 2 * buckets) {
    const index = new Uint32Array(n);
    for (let i = 0; i < n; i++) index[i] = start + i;
    return {
      x: Float64Array.from(index, (i) => x[i]),
      ys: ys.map((y) => Float64Array.from(index, (i) => y[i])),
      index,
    };
  }

  const out = {
    x: new Float64Array(2 * buckets),
    ys: ys.map(() => new Float64Array(2 * buckets)),
    index: new Uint32Array(2 * buckets),
  };
  for (let b = 0; b < buckets; b++) {
    const lo = start + Math.floor((n * b) / buckets);
    const hi = start + Math.floor((n * (b + 1)) / buckets);
    ys.forEach((y, s) => {
      let min = NaN;
      let max = NaN;
      let iMin = lo;
      let iMax = hi - 1;
      for (let i = lo; i < hi; i++) {
        const v = y[i];
        if (!(v >= min)) {
          if (Number.isNaN(v)) continue;
          min = v;
          iMin = i;
        }
        if (!(v <= max)) {
          max = v;
          iMax = i;
        }
      }
      const first = iMin <= iMax;
      out.ys[s][2 * b] = first ? min : max;
      out.ys[s][2 * b + 1] = first ? max : min;
      if (s === 0) {
        out.index[2 * b] = first ? iMin : iMax;
        out.index[2 * b + 1] = first ? iMax : iMin;
      }
    });
    if (!ys.length) {
      out.index[2 * b] = lo;
      out.index[2 * b + 1] = hi - 1;
    }
    out.x[2 * b] = x[out.index[2 * b]];
    out.x[2 * b + 1] = x[out.index[2 * b + 1]];
  }
  return out;
}
