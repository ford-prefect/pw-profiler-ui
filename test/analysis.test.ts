import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clientStats,
  cycleMetrics,
  cycleTimes,
  histogram,
  nodeMetrics,
  quantile,
  summarize,
} from '../src/analysis';
import { buildProfile } from '../src/model';
import { parseText } from '../src/parse/parser';

const load = (name: string) => {
  const { samples, diagnostics } = parseText(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  );
  return buildProfile(samples, diagnostics);
};

describe('metrics', () => {
  /* Expected values follow pw-profiler's dump_point() for the first sample. */
  it('derives driver timings', () => {
    const p = load('start.json');
    const d = p.drivers[0];
    const m = cycleMetrics(d);
    expect(m.period[0]).toBeCloseTo(9997.823, 3);
    expect(m.busy[0]).toBeCloseTo(213.939, 3);
    expect(m.delay[0]).toBeCloseTo(22000, 3);
    expect(m.budget[0]).toBeCloseTo(480e6 / (48000 * 0.999974), 3);
    expect(m.load[0]).toBeCloseTo(m.busy[0] / m.budget[0], 9);
    expect(cycleTimes(d, p.start)[0]).toBeCloseTo((276485769936 - 276485751620) / 1e9, 9);
  });

  it('derives follower timings', () => {
    const d = load('start.json').drivers[0];
    const chromium = d.followers.find((n) => n.name === 'Chromium')!;
    const m = nodeMetrics(d, chromium);
    expect(m.start[0]).toBeCloseTo(0, 3);
    expect(m.latency[0]).toBeCloseTo(29.997, 3);
    expect(m.duration[0]).toBeCloseTo(66.921, 3);
    expect(m.end[0]).toBeCloseTo(96.918, 3);
  });

  it('excludes unfinished and absent followers', () => {
    const d = load('churn.json').drivers[0];
    const chromium = d.followers.find((n) => n.name === 'Chromium')!;
    expect([...nodeMetrics(d, chromium).duration].every(Number.isNaN)).toBe(true);
  });
});

describe('stats', () => {
  const v = Float64Array.from([4, NaN, 1, 3, 2, Infinity]);

  it('summarizes finite values', () => {
    expect(summarize(v)).toMatchObject({ n: 4, min: 1, max: 4, sum: 10, mean: 2.5, p50: 2.5 });
    expect(summarize(v, { start: 2, end: 4 })).toMatchObject({ n: 2, min: 1, max: 3 });
    expect(summarize([]).n).toBe(0);
  });

  it('interpolates quantiles', () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(quantile([7], 0.99)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('bins values, clamping outliers', () => {
    const h = histogram([0, 0.5, 1, 1.5, 2, 99, -5], { bins: 2, min: 0, max: 2 });
    expect([...h.edges]).toEqual([0, 1, 2]);
    expect([...h.counts]).toEqual([3, 4]);
  });
});

describe('clientStats', () => {
  it('aggregates per follower', () => {
    const d = load('start.json').drivers[0];
    const s = clientStats(d);
    expect(s.map((c) => c.node.name)).toEqual(d.followers.map((n) => n.name));
    const chromium = s.find((c) => c.node.name === 'Chromium')!;
    expect(chromium.cycles).toBe(3);
    const busy = summarize(cycleMetrics(d).busy).sum;
    expect(chromium.share).toBeCloseTo(chromium.duration.sum / busy, 9);
  });
});
