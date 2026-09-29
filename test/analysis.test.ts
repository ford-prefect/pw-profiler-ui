import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clientStats,
  clockConfigs,
  cycleBreakdown,
  cycleMetrics,
  cycleTimes,
  findAnomalies,
  histogram,
  nodeMetrics,
  quantile,
  summarize,
  topCycles,
  typicalCycle,
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
    expect(m.expectedPeriod[0]).toBeNaN();
    expect(m.expectedPeriod[1]).toBe(m.budget[0]);
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

describe('anomalies', () => {
  it('finds none in a clean capture', () => {
    expect(findAnomalies(load('start.json').drivers[0])).toEqual([]);
    expect(findAnomalies(load('churn.json').drivers[0])).toEqual([]);
  });

  it('ranks top cycles', () => {
    const v = [3, NaN, 9, 1, 9, 5];
    expect(topCycles(v, 3)).toEqual([2, 4, 5]);
    expect(topCycles(v, 10)).toEqual([2, 4, 5, 0, 3]);
    expect(topCycles(v, 2, { start: 3, end: 6 })).toEqual([4, 5]);
  });
});

describe('clockConfigs', () => {
  it('lists distinct quantum and rate settings', () => {
    expect(clockConfigs(load('start.json').drivers[0])).toEqual([
      { duration: 480, rate: { num: 1, denom: 48000 }, cycles: 3 },
    ]);
  });
});

describe('cycleBreakdown', () => {
  it('orders rows by signal time relative to the driver', () => {
    const d = load('start.json').drivers[0];
    const b = cycleBreakdown(d, 0);
    expect(b.rows.at(-1)).toMatchObject({ driver: true, signal: 0 });
    expect(b.rows.at(-1)!.awake).toBeCloseTo(207.325, 3);
    const signals = b.rows.slice(0, -1).map((r) => r.signal);
    expect(signals).toEqual([...signals].sort((x, y) => x - y));
    const chromium = b.rows.find((r) => r.node.name === 'Chromium')!;
    expect(chromium.finish - chromium.awake).toBeCloseTo(66.921, 3);
  });

  it('leaves unfinished nodes without timings', () => {
    const d = load('churn.json').drivers[0];
    const chromium = cycleBreakdown(d, 0).rows.find((r) => r.node.name === 'Chromium')!;
    expect(chromium.status).toBe('inactive');
    expect(chromium.finish).toBeNaN();
  });

  it('picks the median cycle as typical', () => {
    const d = load('start.json').drivers[0];
    const busy = [...cycleMetrics(d).busy];
    const t = typicalCycle(d)!;
    expect(busy[t.index]).toBe([...busy].sort((a, b) => a - b)[1]);
  });
});
