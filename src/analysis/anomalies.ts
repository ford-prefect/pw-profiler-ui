import type { Driver, Node, Profile } from '../model';
import { asyncReports, cycleMetrics } from './metrics';
import { clampRange, type Range } from './range';

export type AnomalyKind =
  /* An xrun counter increased. */
  | 'xrun'
  /* The graph took longer than the cycle budget. */
  | 'overrun'
  /* A sync node was not finished when the cycle was reported. */
  | 'incomplete'
  /* The driver woke up off its expected period. */
  | 'period';

export interface Anomaly {
  cycle: number;
  kind: AnomalyKind;
  /* Node the anomaly is attributed to, if not the driver. */
  node?: Node;
  /* xrun: counter increase; overrun: load; period: period / expected. */
  value?: number;
}

export interface AnomalyOptions {
  /* Relative deviation from the expected period that is reported. */
  periodTolerance?: number;
}

const UNFINISHED = ['not-triggered', 'triggered', 'awake'];

interface CounterEvent {
  time: number;
  driver: Driver;
  cycle: number;
  value: number;
  node?: Node;
}

const xrunCache = new WeakMap<Profile, Map<Driver, Anomaly[]>>();

/*
 * Increases of xrun counters. A node or clock can move between drivers, as
 * driver or follower, so each counter is followed across all drivers in
 * time order.
 */
function xruns(profile: Profile): Map<Driver, Anomaly[]> {
  let out = xrunCache.get(profile);
  if (out) return out;

  const counters = new Map<string, CounterEvent[]>();
  const add = (key: string, e: CounterEvent) => {
    if (Number.isNaN(e.value)) return;
    let list = counters.get(key);
    if (!list) counters.set(key, (list = []));
    list.push(e);
  };

  for (const driver of profile.drivers) {
    const time = driver.series('clock.nsec');
    const clockXrun = driver.series('clock.xrun');
    const clockName = driver.series('clock.name');
    const xrunCount = driver.series('driver.xrunCount');
    for (let i = 0; i < driver.cycleCount; i++) {
      const t = time[i];
      add(`clock:${driver.string(clockName[i])}`, { time: t, driver, cycle: i, value: clockXrun[i] });
      add(`node:${driver.node.index}`, { time: t, driver, cycle: i, value: xrunCount[i] });
      for (const fc of driver.followerClocks(i)) {
        const node = driver.followers.find((n) => n.id === fc.id);
        add(`clock:${fc.name}`, { time: t, driver, cycle: i, value: fc.xrun, node });
      }
    }
    for (const node of driver.followers) {
      const v = driver.nodeSeries(node, 'xrunCount');
      for (let i = 0; i < driver.cycleCount; i++) {
        add(`node:${node.index}`, { time: time[i], driver, cycle: i, value: v[i], node });
      }
    }
  }

  out = new Map(profile.drivers.map((d) => [d, []]));
  for (const events of counters.values()) {
    events.sort((a, b) => a.time - b.time);
    for (let k = 1; k < events.length; k++) {
      const e = events[k];
      const inc = e.value - events[k - 1].value;
      if (inc > 0) out.get(e.driver)!.push({ cycle: e.cycle, kind: 'xrun', node: e.node, value: inc });
    }
  }
  xrunCache.set(profile, out);
  return out;
}

/* Anomalies of one driver's cycles, in cycle order. */
export function findAnomalies(profile: Profile, driver: Driver, opts: AnomalyOptions = {}): Anomaly[] {
  const tolerance = opts.periodTolerance ?? 0.25;
  const n = driver.cycleCount;
  const m = cycleMetrics(driver);
  const unfinished = new Set(UNFINISHED.map((s) => driver.stringId(s)).filter((i) => i >= 0));
  const out: Anomaly[] = [...xruns(profile).get(driver)!];

  const driverStatus = driver.series('driver.status');
  for (let i = 0; i < n; i++) {
    if (m.load[i] > 1) out.push({ cycle: i, kind: 'overrun', value: m.load[i] });
    const r = m.period[i] / m.expectedPeriod[i];
    if (Math.abs(r - 1) > tolerance) out.push({ cycle: i, kind: 'period', value: r });
    if (unfinished.has(driverStatus[i])) out.push({ cycle: i, kind: 'incomplete', node: driver.node });
  }

  for (const node of driver.followers) {
    const status = driver.nodeSeries(node, 'status');
    const async = asyncReports(driver, node);
    for (let i = 0; i < n; i++) {
      if (!async[i] && unfinished.has(status[i])) out.push({ cycle: i, kind: 'incomplete', node });
    }
  }

  return out.sort((a, b) => a.cycle - b.cycle);
}

/* Indices of the `count` largest finite values, largest first. */
export function topCycles(values: ArrayLike<number>, count: number, range?: Range): number[] {
  const { start, end } = clampRange(range, values.length);
  const top: number[] = [];
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (top.length === count && v <= values[top[count - 1]]) continue;
    let j = top.length === count ? count - 1 : top.length;
    while (j > 0 && values[top[j - 1]] < v) {
      top[j] = top[j - 1];
      j--;
    }
    top[j] = i;
  }
  return top;
}
