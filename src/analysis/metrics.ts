import type { Driver, Node } from '../model';
import { clampRange, type Range } from './range';

/*
 * Derived per-cycle series. Durations are in µs, as in pw-profiler's plots.
 * Unlike pw-profiler, invalid values are NaN rather than clamped to 0.
 */

export interface CycleMetrics {
  /* Current signal - previous signal; NaN after an idle gap. */
  period: Float64Array;
  /* 1 where the driver (re)started after being idle, including its first run. */
  gap: Uint8Array;
  /* Driver signal -> driver finish: total graph processing time. */
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

/* SPA_IO_CLOCK_FLAG_NO_RATE: the clock rate is only approximate. */
const CLOCK_FLAG_NO_RATE = 1 << 3;

/*
 * A period this many times the expected one means the driver was idle, not
 * late. Without an expected period, one over a second does.
 */
const IDLE_FACTOR = 10;
const IDLE_US = 1e6;

/* Seconds from `origin` (ns) to each cycle's driver signal. */
export function cycleTimes(driver: Driver, origin: number): Float64Array {
  const signal = driver.series('driver.signal');
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = (signal[i] - origin) / 1e9;
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

  m = {
    period: new Float64Array(n),
    gap: new Uint8Array(n),
    busy: new Float64Array(n),
    budget: new Float64Array(n),
    expectedPeriod: new Float64Array(n),
    delay: new Float64Array(n),
    load: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const tick = (1e6 * num[i]) / denom[i];
    m.busy[i] = pos((finish[i] - signal[i]) / 1e3);
    m.budget[i] = flags[i] & CLOCK_FLAG_NO_RATE ? NaN : (duration[i] * tick) / diff[i];
    m.expectedPeriod[i] = i > 0 ? m.budget[i - 1] : NaN;

    const period = pos((signal[i] - prev[i]) / 1e3);
    const idle = Number.isFinite(m.expectedPeriod[i]) ? IDLE_FACTOR * m.expectedPeriod[i] : IDLE_US;
    /* prev is 0 before the driver's first run. */
    m.gap[i] = prev[i] === 0 || period > idle ? 1 : 0;
    m.period[i] = m.gap[i] ? NaN : period;
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
 * Captures from older pw-profiler lack the async field; there a follower
 * that ran, or is running, with a signal time before the driver's is async,
 * since a sync follower is only signalled within the cycle.
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
  const running = new Set(['triggered', 'awake', 'finished'].map((s) => driver.stringId(s)));

  out = new Uint8Array(driver.cycleCount);
  for (let i = 0; i < out.length; i++) {
    if (!Number.isNaN(flag[i])) out[i] = flag[i];
    else out[i] = running.has(status[i]) && signal[i] < cycleSignal[i] ? 1 : 0;
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

  m = {
    start: new Float64Array(n).fill(NaN),
    latency: new Float64Array(n).fill(NaN),
    duration: new Float64Array(n).fill(NaN),
    end: new Float64Array(n).fill(NaN),
  };
  for (let i = 0; i < n; i++) {
    let c = i;
    if (async[i]) {
      /* The previous run, if it was in the previous recorded cycle. */
      c = i - 1;
      if (c < 0 || !(signal[i] >= cycleSignal[c] && finish[i] >= awake[i] && awake[i] >= signal[i])) continue;
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
  cycles: number;
}

/* Distinct (quantum, rate) settings in range, most used first. */
export function clockConfigs(driver: Driver, range?: Range): ClockConfig[] {
  const { start, end } = clampRange(range, driver.cycleCount);
  const duration = driver.series('clock.duration');
  const num = driver.series('clock.rateNum');
  const denom = driver.series('clock.rateDenom');
  const seen = new Map<string, ClockConfig>();
  for (let i = start; i < end; i++) {
    const key = `${duration[i]}:${num[i]}/${denom[i]}`;
    const c = seen.get(key);
    if (c) c.cycles++;
    else seen.set(key, { duration: duration[i], rate: { num: num[i], denom: denom[i] }, cycles: 1 });
  }
  return [...seen.values()].sort((a, b) => b.cycles - a.cycles);
}
