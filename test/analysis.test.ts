import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeSpans,
  asyncReports,
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
    expect(cycleTimes(d, p.start)[1]).toBeCloseTo((276495751877 - 276485751620) / 1e9, 9);
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
    const start = load('start.json');
    expect(findAnomalies(start, start.drivers[0])).toEqual([]);
    const churn = load('churn.json');
    expect(findAnomalies(churn, churn.drivers[0])).toEqual([]);
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
      { duration: 480, rate: { num: 1, denom: 48000 }, fixedRate: true, cycles: 3 },
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

describe('driver gaps', () => {
  const profiles = new Map<string, ReturnType<typeof load>>();
  const driverNamed = (fixture: string, prefix: string) => {
    if (!profiles.has(fixture)) profiles.set(fixture, load(fixture));
    return profiles.get(fixture)!.drivers.find((d) => d.node.name.startsWith(prefix))!;
  };

  it('ignores the period before a first run', () => {
    const d = driverNamed('start-prev0.json', 'alsa_input.usb-046d');
    const m = cycleMetrics(d);
    expect(m.gap[0]).toBe(1);
    expect(m.period[0]).toBeNaN();
    expect(m.gap[1]).toBe(0);
    expect(m.period[1]).toBeCloseTo(m.budget[0], -2);
  });

  it('ignores the period spanning an idle driver', () => {
    const d = driverNamed('handover.json', 'alsa_output.usb-SMSL');
    const m = cycleMetrics(d);
    expect(m.gap[0]).toBe(1);
    expect(m.period[0]).toBeNaN();
    expect([...m.gap.subarray(1)].every((g) => g === 0)).toBe(true);
  });

  it('has no budget for clocks without a fixed rate', () => {
    const d = driverNamed('start-prev0.json', 'v4l2_input');
    const m = cycleMetrics(d);
    expect(m.budget[0]).toBeNaN();
    expect(m.load[0]).toBeNaN();
    expect(clockConfigs(d)[0].fixedRate).toBe(false);
    expect(findAnomalies(profiles.get('start-prev0.json')!, d)).toEqual([]);
  });
});

describe('async followers', () => {
  const setup = () => {
    const p = load('async.json');
    const d = p.drivers.find((d) => d.node.name.startsWith('v4l2_input'))!;
    return { p, d, node: d.followers.find((n) => n.name === 'org.gnome.Snapshot')! };
  };

  it('are inferred without the async field', () => {
    const { d, node } = setup();
    expect([...asyncReports(d, node)]).toEqual([1, 1, 1, 1]);
    expect(clientStats(d)[0].async).toBe(true);
  });

  it('have runs attributed to the cycle they ran in', () => {
    const { d, node } = setup();
    const m = nodeMetrics(d, node);
    expect(m.latency[0]).toBeCloseTo(18.004, 3);
    expect(m.duration[0]).toBeCloseTo(13.415, 3);
    expect(m.end[0]).toBeCloseTo(31.419, 3);
    expect(m.duration[3]).toBeNaN();
    const row = cycleBreakdown(d, 0).rows.find((r) => r.node === node)!;
    expect(row).toMatchObject({ async: true, status: 'finished' });
    expect(row.finish).toBeCloseTo(31.419, 3);
  });

  it('are not reported as unfinished', () => {
    const { p, d } = setup();
    expect(findAnomalies(p, d)).toEqual([]);
  });
});

describe('driver role changes', () => {
  const setup = () => {
    const p = load('roles.json');
    const byId = (id: number) => p.drivers.find((d) => d.node.id === id)!;
    return { p, sink: byId(70), dummy: byId(34), mic: byId(71) };
  };

  it('treats timings far from the clock time as stale', () => {
    const { dummy } = setup();
    const m = cycleMetrics(dummy);
    expect([...m.stale]).toEqual([1, 0, 0, 0]);
    expect(m.busy[0]).toBeNaN();
    expect(m.gap[0]).toBe(1);
    expect(cycleBreakdown(dummy, 0).rows.every((r) => Number.isNaN(r.finish))).toBe(true);
  });

  it('follows xrun counters across drivers', () => {
    const { p, dummy, sink, mic } = setup();
    const summary = (d: typeof sink) =>
      findAnomalies(p, d).map((a) =>
        a.kind === 'xrun'
          ? [a.cycle, 'xrun', a.node?.name ?? a.clock ?? 'driver', a.increase]
          : a.kind === 'incomplete'
            ? [a.cycle, 'incomplete', a.counters.map((c) => [c.node?.name, c.increase])]
            : [a.cycle, a.kind],
      );
    /*
     * Dummy-Driver's first report is incomplete, with a run left from its
     * previous activation; echo-cancel counters rise 1 -> 2 under it ...
     */
    expect(summary(dummy)).toEqual([
      [2, 'xrun', 'echo_cancel_source', 1],
      [2, 'xrun', 'echo_cancel_playback', 1],
    ]);
    /* ... then to 26 by the time the mic drives, and 28 later; the mic's own count rises too. */
    expect(summary(mic)).toEqual([
      [0, 'xrun', 'echo_cancel_source', 24],
      [0, 'xrun', 'echo_cancel_playback', 23],
      [1, 'incomplete', []],
      [2, 'xrun', 'echo_cancel_source', 2],
      [2, 'xrun', 'echo_cancel_playback', 2],
      [2, 'xrun', 'driver', 3],
    ]);
    expect(summary(sink)).toEqual([]);
  });

  it('breaks where the record jumps ahead', () => {
    const { sink } = setup();
    const m = cycleMetrics(sink);
    /* Driver at 12.8s and 13.0s, a follower of the mic, then driver at 193.4s. */
    expect([...m.gap]).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(m.period[5]).toBeNaN();
    expect(m.period[6]).toBeCloseTo(m.budget[5], -2);
  });
});

describe('activeSpans', () => {
  it('splits activity at gaps', () => {
    const p = load('roles.json');
    const sink = p.drivers.find((d) => d.node.id === 70)!;
    const spans = activeSpans(sink, cycleTimes(sink, p.start));
    expect(spans.map((s) => [s.first, s.end, s.followers])).toEqual([
      [0, 5, 0],
      [5, 7, 0],
    ]);
    expect(spans[1].start - spans[0].stop).toBeGreaterThan(180);
    const mic = p.drivers.find((d) => d.node.id === 71)!;
    expect(activeSpans(mic, cycleTimes(mic, p.start)).map((s) => [s.first, s.end, s.followers])).toEqual([
      [0, 2, 19],
      [2, 5, 18],
    ]);
  });
});

describe('xrun recovery', () => {
  /* Mic cycles around a new node joining: 2 is incomplete, 3 its recovery. */
  const setup = () => {
    const p = load('incident.json');
    return { p, d: p.drivers[0] };
  };

  it('classifies reports', () => {
    const { d } = setup();
    expect([...cycleMetrics(d).report]).toEqual([0, 0, 1, 2, 0, 0]);
  });

  it('keeps incomplete and recovery reports out of timings', () => {
    const { d } = setup();
    const m = cycleMetrics(d);
    expect([m.busy[2], m.busy[3], m.period[2], m.period[3]].every(Number.isNaN)).toBe(true);
    expect(m.busy[4]).toBeCloseTo(1429.0, 1);
    const eq = d.followers.find((n) => n.name === 'eq_capture')!;
    /* The stuck run is taken from the recovery report. */
    expect(nodeMetrics(d, eq).duration[2]).toBeNaN();
    expect(nodeMetrics(d, eq).duration[3]).toBeCloseTo(46.4 - 28.7, 1);
  });
});

describe('incomplete graph runs', () => {
  it('are one incident naming the node that never ran', () => {
    const p = load('incident.json');
    const [a, ...rest] = findAnomalies(p, p.drivers[0]);
    expect(rest).toEqual([]);
    if (a.kind !== 'incomplete') throw new Error(a.kind);
    expect(a).toMatchObject({ cycle: 2, end: 4, recovery: 3 });
    expect(a.completion).toBeCloseTo(10082.4, 1);
    expect(a.blocked.map((b) => [b.node.name, b.status, b.joined])).toEqual([
      ['Brotato.504.spatialize_filter_chain.playback', 'not-triggered', true],
    ]);
    /* The driver's counter goes up in the report after the recovery. */
    expect(a.counters.map((c) => [c.cycle, c.node, c.increase])).toEqual([[4, undefined, 1]]);
  });

  it('leave node-reported xruns as bursts', () => {
    const p = load('setup-xruns.json');
    const dummy = p.drivers.find((d) => d.node.name === 'Dummy-Driver')!;
    const xruns = findAnomalies(p, dummy).filter((a) => a.kind === 'xrun');
    /* Playback did not rise at 10. */
    expect(xruns.map((a) => a.kind === 'xrun' && [a.node?.name, a.cycle, a.end, a.count])).toEqual([
      ['echo_cancel_source', 2, 17, 9],
      ['echo_cancel_playback', 2, 17, 8],
    ]);
    expect(findAnomalies(p, dummy).filter((a) => a.kind === 'incomplete')).toEqual([]);
  });
});
