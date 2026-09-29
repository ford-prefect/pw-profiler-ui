import type { Driver, Node } from '../model';
import { clampRange, type Range } from './range';

/*
 * Derived per-cycle series. Durations are in µs, as in pw-profiler's plots.
 * Unlike pw-profiler, invalid values are NaN rather than clamped to 0.
 */

export interface CycleMetrics {
  /* Current signal - previous signal. */
  period: Float64Array;
  /* Driver signal -> driver finish: total graph processing time. */
  busy: Float64Array;
  /* Cycle duration in rate-corrected time: the processing budget. */
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

  m = {
    period: new Float64Array(n),
    busy: new Float64Array(n),
    budget: new Float64Array(n),
    expectedPeriod: new Float64Array(n),
    delay: new Float64Array(n),
    load: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const tick = (1e6 * num[i]) / denom[i];
    m.period[i] = pos((signal[i] - prev[i]) / 1e3);
    m.busy[i] = pos((finish[i] - signal[i]) / 1e3);
    m.budget[i] = (duration[i] * tick) / diff[i];
    m.expectedPeriod[i] = i > 0 ? m.budget[i - 1] : NaN;
    m.delay[i] = delay[i] * tick;
    m.load[i] = m.busy[i] / m.budget[i];
  }
  cycleCache.set(driver, m);
  return m;
}

/* Timings of a follower; NaN in cycles where it is absent or did not finish. */
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

  m = {
    start: new Float64Array(n).fill(NaN),
    latency: new Float64Array(n).fill(NaN),
    duration: new Float64Array(n).fill(NaN),
    end: new Float64Array(n).fill(NaN),
  };
  for (let i = 0; i < n; i++) {
    if (status[i] !== finished) continue;
    m.start[i] = pos((signal[i] - cycleSignal[i]) / 1e3);
    m.latency[i] = pos((awake[i] - signal[i]) / 1e3);
    m.duration[i] = pos((finish[i] - awake[i]) / 1e3);
    m.end[i] = pos((finish[i] - cycleSignal[i]) / 1e3);
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
