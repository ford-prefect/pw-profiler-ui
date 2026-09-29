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

/*
 * Inserts a NaN point wherever `breaks` marks a source index between two
 * consecutive output points, so lines are not drawn across gaps.
 */
export function breakAt(d: Decimated, breaks: ArrayLike<number>): Decimated {
  const cum = new Uint32Array(breaks.length + 1);
  for (let i = 0; i < breaks.length; i++) cum[i + 1] = cum[i] + (breaks[i] ? 1 : 0);
  if (cum[breaks.length] === 0) return d;

  const at: number[] = [];
  for (let k = 1; k < d.index.length; k++) {
    if (cum[d.index[k] + 1] - cum[d.index[k - 1] + 1] > 0) at.push(k);
  }
  if (!at.length) return d;

  const n = d.index.length + at.length;
  const out: Decimated = {
    x: new Float64Array(n),
    ys: d.ys.map(() => new Float64Array(n)),
    index: new Uint32Array(n),
  };
  let o = 0;
  let a = 0;
  for (let k = 0; k < d.index.length; k++) {
    if (at[a] === k) {
      a++;
      out.x[o] = (d.x[k - 1] + d.x[k]) / 2;
      out.ys.forEach((y) => (y[o] = NaN));
      out.index[o] = d.index[k];
      o++;
    }
    out.x[o] = d.x[k];
    out.ys.forEach((y, s) => (y[o] = d.ys[s][k]));
    out.index[o] = d.index[k];
    o++;
  }
  return out;
}
