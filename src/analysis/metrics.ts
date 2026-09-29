import type { Driver, Node } from '../model';
import { clampRange, type Range } from './range';

/*
 * Derived per-cycle series. Durations are in µs, as in pw-profiler's plots.
 * Unlike pw-profiler, invalid values are NaN rather than clamped to 0.
 */

/*
 * What a profiler report is. At each wakeup, a driver whose previous graph
 * run did not finish emits an incomplete report, then completes that run in
 * xrun recovery and reports again, so one period can produce three reports.
 */
export const Report = {
  Normal: 0,
  /* The graph run had not finished at the next wakeup; driver timings are stale. */
  Incomplete: 1,
  /* The unfinished run, completed at the next wakeup (XRUN_RECOVER). */
  Recovery: 2,
} as const;

export interface CycleMetrics {
  report: Uint8Array;
  /* Current signal - previous signal; NaN after an idle gap or in reports other than normal. */
  period: Float64Array;
  /*
   * 1 where the cycle does not continue the previous one: the driver
   * (re)started after being idle or first ran, the record jumps ahead, or
   * the cycle is stale.
   */
  gap: Uint8Array;
  /* 1 where the driver's timings are not from this cycle. */
  stale: Uint8Array;
  /* Driver signal -> driver finish: total graph processing time. NaN in reports other than normal. */
  busy: Float64Array;
  /*
   * Cycle duration in rate-corrected time: the processing budget. NaN for
   * clocks without a fixed rate (e.g. video), where it is not meaningful.
   */
  budget: Float64Array;
  /* Period the driver should have woken up after: the previous budget. */
  expectedPeriod: Float64Array;
  /* Hardware pointer delay at wakeup. */
  delay: Float64Array;
  /* busy / budget */
  load: Float64Array;
}

export interface NodeMetrics {
  /* Driver signal -> node signalled. */
  start: Float64Array;
  /* Node signalled -> awake (scheduling latency). */
  latency: Float64Array;
  /* Awake -> finish (processing time). */
  duration: Float64Array;
  /* Driver signal -> node finish. */
  end: Float64Array;
}

const cycleCache = new WeakMap<Driver, CycleMetrics>();
const nodeCache = new WeakMap<Driver, Map<number, NodeMetrics>>();

const pos = (v: number) => (v >= 0 ? v : NaN);

/* SPA_IO_CLOCK_FLAG_XRUN_RECOVER: the driver is completing an unfinished run. */
const CLOCK_FLAG_XRUN_RECOVER = 1 << 1;
/* SPA_IO_CLOCK_FLAG_NO_RATE: the clock rate is only approximate. */
const CLOCK_FLAG_NO_RATE = 1 << 3;

/*
 * A period this many times the expected one means the driver was idle, not
 * late. Without an expected period, one over a second does.
 */
const IDLE_FACTOR = 10;
const IDLE_US = 1e6;

/* Driver timings further than this from the clock time (ns) are stale. */
const STALE_NS = 1e9;

/*
 * Seconds from `origin` (ns) to each cycle's clock time. The clock time is
 * used as driver timings can be stale on a driver's first cycle.
 */
export function cycleTimes(driver: Driver, origin: number): Float64Array {
  const nsec = driver.series('clock.nsec');
  const out = new Float64Array(nsec.length);
  for (let i = 0; i < nsec.length; i++) out[i] = (nsec[i] - origin) / 1e9;
  return out;
}

export function cycleMetrics(driver: Driver): CycleMetrics {
  let m = cycleCache.get(driver);
  if (m) return m;

  const n = driver.cycleCount;
  const prev = driver.series('driver.prev');
  const signal = driver.series('driver.signal');
  const finish = driver.series('driver.finish');
  const num = driver.series('clock.rateNum');
  const denom = driver.series('clock.rateDenom');
  const duration = driver.series('clock.duration');
  const delay = driver.series('clock.delay');
  const diff = driver.series('clock.diff');
  const flags = driver.series('clock.flags');
  const nsec = driver.series('clock.nsec');
  const status = driver.series('driver.status');
  const finished = driver.stringId('finished');

  m = {
    report: new Uint8Array(n),
    period: new Float64Array(n),
    gap: new Uint8Array(n),
    stale: new Uint8Array(n),
    busy: new Float64Array(n),
    budget: new Float64Array(n),
    expectedPeriod: new Float64Array(n),
    delay: new Float64Array(n),
    load: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const tick = (1e6 * num[i]) / denom[i];
    m.report[i] =
      flags[i] & CLOCK_FLAG_XRUN_RECOVER ? Report.Recovery : status[i] !== finished ? Report.Incomplete : Report.Normal;
    m.stale[i] = Math.abs(signal[i] - nsec[i]) > STALE_NS ? 1 : 0;
    const normal = !m.stale[i] && m.report[i] === Report.Normal;
    m.busy[i] = normal ? pos((finish[i] - signal[i]) / 1e3) : NaN;
    m.budget[i] = flags[i] & CLOCK_FLAG_NO_RATE ? NaN : (duration[i] * tick) / diff[i];
    m.expectedPeriod[i] = i > 0 ? m.budget[i - 1] : NaN;

    const period = pos((signal[i] - prev[i]) / 1e3);
    const idle = Number.isFinite(m.expectedPeriod[i]) ? IDLE_FACTOR * m.expectedPeriod[i] : IDLE_US;
    /*
     * The record jumps ahead when the node kept running as a follower of
     * another driver. Its period then spans the change of driver.
     */
    const jump = i > 0 && (nsec[i] - nsec[i - 1]) / 1e3 > IDLE_US;
    /* prev is 0 before the driver's first run. */
    m.gap[i] = m.stale[i] || jump || prev[i] === 0 || period > idle ? 1 : 0;
    m.period[i] = m.gap[i] || !normal ? NaN : period;
    m.delay[i] = delay[i] * tick;
    m.load[i] = m.busy[i] / m.budget[i];
  }
  cycleCache.set(driver, m);
  return m;
}

const asyncCache = new WeakMap<Driver, Map<number, Uint8Array>>();

/*
 * 1 where the follower's block is an async report: the driver does not wait
 * for async followers, so the server reports their previous run's timings.
 * Captures from older pw-profiler lack the async field; there a report
 * looks async if the follower ran, or is running, with a signal time in the
 * driver's previous cycle, since a sync follower is only signalled within
 * the cycle. Older timings are left from a run before that: the node did not
 * run. As nodes that did not run can look async in single reports, a node
 * without the field is async if most of its reports look async.
 */
export function asyncReports(driver: Driver, node: Node): Uint8Array {
  let byNode = asyncCache.get(driver);
  if (!byNode) asyncCache.set(driver, (byNode = new Map()));
  let out = byNode.get(node.index);
  if (out) return out;

  const flag = driver.nodeSeries(node, 'async');
  const status = driver.nodeSeries(node, 'status');
  const signal = driver.nodeSeries(node, 'signal');
  const cycleSignal = driver.series('driver.signal');
  const prev = driver.series('driver.prev');
  const running = new Set(['triggered', 'awake', 'finished'].map((s) => driver.stringId(s)));

  out = new Uint8Array(driver.cycleCount);
  let present = 0;
  let looksAsync = 0;
  /* The latest driver signal and the one before it; incomplete reports repeat a signal. */
  let last = prev[0] > 0 ? prev[0] : -Infinity;
  let before = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const s = cycleSignal[i];
    const start = s > last ? last : before;
    if (s > last) {
      before = last;
      last = s;
    }
    if (!Number.isNaN(flag[i])) {
      out[i] = flag[i];
    } else if (running.has(status[i])) {
      present++;
      if (signal[i] >= start && signal[i] < s) looksAsync++;
    }
  }
  if (looksAsync > present / 2) {
    for (let i = 0; i < out.length; i++) if (Number.isNaN(flag[i]) && !Number.isNaN(status[i])) out[i] = 1;
  }
  byNode.set(node.index, out);
  return out;
}

/*
 * Timings of a follower; NaN in cycles where it is absent or did not finish.
 * Async followers' runs are attributed to the cycle they ran in.
 */
export function nodeMetrics(driver: Driver, node: Node): NodeMetrics {
  let byNode = nodeCache.get(driver);
  if (!byNode) nodeCache.set(driver, (byNode = new Map()));
  let m = byNode.get(node.index);
  if (m) return m;

  const n = driver.cycleCount;
  const cycleSignal = driver.series('driver.signal');
  const status = driver.nodeSeries(node, 'status');
  const signal = driver.nodeSeries(node, 'signal');
  const awake = driver.nodeSeries(node, 'awake');
  const finish = driver.nodeSeries(node, 'finish');
  const finished = driver.stringId('finished');
  const async = asyncReports(driver, node);
  const { stale, report } = cycleMetrics(driver);

  m = {
    start: new Float64Array(n).fill(NaN),
    latency: new Float64Array(n).fill(NaN),
    duration: new Float64Array(n).fill(NaN),
    end: new Float64Array(n).fill(NaN),
  };
  for (let i = 0; i < n; i++) {
    /* Incomplete reports repeat the run of the recovery report after them. */
    if (stale[i] || report[i] === Report.Incomplete) continue;
    let c = i;
    if (async[i]) {
      /* The previous run, if it was in the previous recorded cycle. */
      c = i - 1;
      if (c < 0 || stale[c] || !(signal[i] >= cycleSignal[c] && finish[i] >= awake[i] && awake[i] >= signal[i])) continue;
    } else if (status[i] !== finished) {
      continue;
    }
    m.start[c] = pos((signal[i] - cycleSignal[c]) / 1e3);
    m.latency[c] = pos((awake[i] - signal[i]) / 1e3);
    m.duration[c] = pos((finish[i] - awake[i]) / 1e3);
    m.end[c] = pos((finish[i] - cycleSignal[c]) / 1e3);
  }
  byNode.set(node.index, m);
  return m;
}

export interface ClockConfig {
  duration: number;
  rate: { num: number; denom: number };
  /* False for clocks flagged NO_RATE, whose rate is approximate. */
  fixedRate: boolean;
  cycles: number;
}

/* Distinct (quantum, rate) settings in range, most used first. */
export function clockConfigs(driver: Driver, range?: Range): ClockConfig[] {
  const { start, end } = clampRange(range, driver.cycleCount);
  const duration = driver.series('clock.duration');
  const num = driver.series('clock.rateNum');
  const denom = driver.series('clock.rateDenom');
  const flags = driver.series('clock.flags');
  const seen = new Map<string, ClockConfig>();
  for (let i = start; i < end; i++) {
    const fixedRate = !(flags[i] & CLOCK_FLAG_NO_RATE);
    const key = `${duration[i]}:${num[i]}/${denom[i]}:${fixedRate}`;
    const c = seen.get(key);
    if (c) c.cycles++;
    else
      seen.set(key, {
        duration: duration[i],
        rate: { num: num[i], denom: denom[i] },
        fixedRate,
        cycles: 1,
      });
  }
  return [...seen.values()].sort((a, b) => b.cycles - a.cycles);
}
