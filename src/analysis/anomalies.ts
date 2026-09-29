import type { Driver, Node, Profile } from '../model';
import { asyncReports, cycleMetrics, Report } from './metrics';
import { clampRange, type Range } from './range';

/* An xrun counter going up in a cycle's report. */
export interface CounterIncrease {
  cycle: number;
  /* The node whose counter it is; neither node nor clock means the driver. */
  node?: Node;
  clock?: string;
  increase: number;
}

/* A node that held up an incomplete graph run. */
export interface Blocked {
  node: Node;
  /* not-triggered: waiting on its inputs; triggered: never woke up; awake: did not finish. */
  status: string;
  /* Absent or inactive in the report before, so it just joined the graph. */
  joined: boolean;
}

interface Span {
  /* First report and one past the last one it covers. */
  cycle: number;
  end: number;
}

export type Anomaly =
  /* The graph run had not finished by the driver's next wakeup. */
  | (Span & {
      kind: 'incomplete';
      blocked: Blocked[];
      /* The recovery report, where the run completed. */
      recovery?: number;
      /* Driver signal to completion of the run, µs. */
      completion: number;
      /* Counters that went up with it. */
      counters: CounterIncrease[];
    })
  /* xrun counters that went up outside incomplete runs, merged into bursts. */
  | (Span & { kind: 'xrun'; node?: Node; clock?: string; increase: number; count: number })
  /* The graph took longer than the cycle budget. */
  | (Span & { kind: 'overrun'; load: number })
  /* The driver woke up off its expected period. */
  | (Span & { kind: 'period'; ratio: number });

export type AnomalyKind = Anomaly['kind'];

export interface AnomalyOptions {
  /* Relative deviation from the expected period that is reported. */
  periodTolerance?: number;
}

const UNFINISHED = ['not-triggered', 'triggered', 'awake'];

/* Counter increases this close together (ns) are merged into one burst. */
const BURST_NS = 1e9;

interface CounterEvent {
  time: number;
  driver: Driver;
  cycle: number;
  value: number;
  node?: Node;
  clock?: string;
}

const xrunCache = new WeakMap<Profile, Map<Driver, CounterIncrease[]>>();

/*
 * Increases of xrun counters. A node or clock can move between drivers, as
 * driver or follower, so each counter is followed across all drivers in
 * time order.
 */
function counterIncreases(profile: Profile): Map<Driver, CounterIncrease[]> {
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
      const clock = driver.string(clockName[i]);
      add(`clock:${clock}`, { time: t, driver, cycle: i, value: clockXrun[i], clock });
      add(`node:${driver.node.index}`, { time: t, driver, cycle: i, value: xrunCount[i] });
      for (const fc of driver.followerClocks(i)) {
        add(`clock:${fc.name}`, { time: t, driver, cycle: i, value: fc.xrun, clock: fc.name });
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
      const increase = e.value - events[k - 1].value;
      if (increase > 0) out.get(e.driver)!.push({ cycle: e.cycle, node: e.node, clock: e.clock, increase });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.cycle - b.cycle);
  xrunCache.set(profile, out);
  return out;
}

function incidents(driver: Driver, counters: CounterIncrease[]): { found: Anomaly[]; used: Set<CounterIncrease> } {
  const { report, gap } = cycleMetrics(driver);
  const n = driver.cycleCount;
  const signal = driver.series('driver.signal');
  const finish = driver.series('driver.finish');
  const unfinished = new Set(UNFINISHED.map((s) => driver.stringId(s)).filter((i) => i >= 0));
  const inactive = driver.stringId('inactive');
  const found: Anomaly[] = [];
  const used = new Set<CounterIncrease>();

  for (let i = 0; i < n; i++) {
    const r = report[i];
    if (r === Report.Normal || (r === Report.Recovery && i > 0 && report[i - 1] === Report.Incomplete)) continue;

    const recovery = r === Report.Recovery ? i : i + 1 < n && report[i + 1] === Report.Recovery ? i + 1 : undefined;
    const last = recovery ?? i;

    const blocked: Blocked[] = [];
    for (const node of driver.followers) {
      const status = driver.nodeSeries(node, 'status');
      if (!unfinished.has(status[i]) || asyncReports(driver, node)[i]) continue;
      const before = i > 0 ? status[i - 1] : NaN;
      blocked.push({
        node,
        status: driver.string(status[i])!,
        joined: Number.isNaN(before) || before === inactive,
      });
    }

    /* Counters register the xrun up to the report after the recovery. */
    const window = last + 1 < n && !gap[last + 1] ? last + 1 : last;
    const attached = counters.filter((c) => c.cycle >= i && c.cycle <= window);
    attached.forEach((c) => used.add(c));

    found.push({
      kind: 'incomplete',
      cycle: i,
      end: last + 1,
      blocked,
      recovery,
      completion: recovery === undefined ? NaN : (finish[recovery] - signal[recovery]) / 1e3,
      counters: attached,
    });
  }
  return { found, used };
}

/* Merges counter increases of the same counter that follow closely into bursts. */
function bursts(driver: Driver, counters: CounterIncrease[]): Anomaly[] {
  const time = driver.series('clock.nsec');
  const open = new Map<string, Anomaly & { kind: 'xrun' }>();
  const out: Anomaly[] = [];
  for (const c of counters) {
    const key = c.clock ? `clock:${c.clock}` : `node:${c.node?.index ?? 'driver'}`;
    const b = open.get(key);
    if (b && time[c.cycle] - time[b.end - 1] <= BURST_NS) {
      b.end = c.cycle + 1;
      b.increase += c.increase;
      b.count++;
      continue;
    }
    const next = { kind: 'xrun' as const, cycle: c.cycle, end: c.cycle + 1, node: c.node, clock: c.clock, increase: c.increase, count: 1 };
    open.set(key, next);
    out.push(next);
  }
  return out;
}

/* Anomalies of one driver's cycles, in cycle order. */
export function findAnomalies(profile: Profile, driver: Driver, opts: AnomalyOptions = {}): Anomaly[] {
  const tolerance = opts.periodTolerance ?? 0.25;
  const m = cycleMetrics(driver);
  const counters = counterIncreases(profile).get(driver)!;
  const { found, used } = incidents(driver, counters);
  const out = [...found, ...bursts(driver, counters.filter((c) => !used.has(c)))];

  for (let i = 0; i < driver.cycleCount; i++) {
    if (m.load[i] > 1) out.push({ kind: 'overrun', cycle: i, end: i + 1, load: m.load[i] });
    const ratio = m.period[i] / m.expectedPeriod[i];
    if (Math.abs(ratio - 1) > tolerance) out.push({ kind: 'period', cycle: i, end: i + 1, ratio });
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
