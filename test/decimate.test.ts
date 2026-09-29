import { describe, expect, it } from 'vitest';
import { breakAt, decimate } from '../src/view/chart/decimate';

describe('decimate', () => {
  const x = Float64Array.from({ length: 12 }, (_, i) => i);

  it('passes small ranges through', () => {
    const d = decimate(x, [x], 2, 6, 10);
    expect([...d.x]).toEqual([2, 3, 4, 5]);
    expect([...d.index]).toEqual([2, 3, 4, 5]);
  });

  it('keeps extremes of each bucket in order', () => {
    const y = [5, 9, 1, 5, 5, 5, 0, 5, 5, 7, 5, 5];
    const d = decimate(x, [y], 0, 12, 3);
    expect([...d.ys[0]]).toEqual([9, 1, 5, 0, 5, 7]);
    expect([...d.index]).toEqual([1, 2, 4, 6, 8, 9]);
    expect([...d.x]).toEqual([1, 2, 4, 6, 8, 9]);
  });

  it('skips NaN', () => {
    const y = [NaN, NaN, NaN, NaN, 3, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
    const d = decimate(x, [x, y], 0, 12, 3);
    expect([...d.ys[1]]).toEqual([NaN, NaN, 3, 3, NaN, NaN]);
  });
});

describe('breakAt', () => {
  it('inserts a gap before marked indices', () => {
    const x = [0, 1, 2, 10, 11];
    const d = decimate(x, [x], 0, 5, 10);
    const b = breakAt(d, [1, 0, 0, 1, 0]);
    expect([...b.x]).toEqual([0, 1, 2, 6, 10, 11]);
    expect([...b.ys[0]]).toEqual([0, 1, 2, NaN, 10, 11]);
  });

  it('leaves data without breaks alone', () => {
    const d = decimate([0, 1], [[0, 1]], 0, 2, 10);
    expect(breakAt(d, [0, 0])).toBe(d);
  });
});
