import type { Driver, Node } from '../model';
import { cycleMetrics } from './metrics';
import { clampRange, type Range } from './range';

export type AnomalyKind =
  /* An xrun counter increased. */
  | 'xrun'
  /* The graph took longer than the cycle budget. */
  | 'overrun'
  /* A node was not finished when the cycle was reported. */
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

/* Anomalies in cycle order. */
export function findAnomalies(driver: Driver, opts: AnomalyOptions = {}): Anomaly[] {
  const tolerance = opts.periodTolerance ?? 0.25;
  const n = driver.cycleCount;
  const m = cycleMetrics(driver);
  const unfinished = new Set(UNFINISHED.map((s) => driver.stringId(s)).filter((i) => i >= 0));
  const out: Anomaly[] = [];

  const counter = (values: ArrayLike<number>, node?: Node) => {
    let last = NaN;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (Number.isNaN(v)) continue;
      if (v > last) out.push({ cycle: i, kind: 'xrun', node, value: v - last });
      last = v;
    }
  };
  counter(driver.series('clock.xrun'));
  counter(driver.series('driver.xrunCount'));
  for (const node of driver.followers) counter(driver.nodeSeries(node, 'xrunCount'), node);

  const driverStatus = driver.series('driver.status');
  for (let i = 0; i < n; i++) {
    if (m.load[i] > 1) out.push({ cycle: i, kind: 'overrun', value: m.load[i] });
    const r = m.period[i] / m.expectedPeriod[i];
    if (Math.abs(r - 1) > tolerance) out.push({ cycle: i, kind: 'period', value: r });
    if (unfinished.has(driverStatus[i])) out.push({ cycle: i, kind: 'incomplete', node: driver.node });
  }

  for (const node of driver.followers) {
    const status = driver.nodeSeries(node, 'status');
    for (let i = 0; i < n; i++) {
      if (unfinished.has(status[i])) out.push({ cycle: i, kind: 'incomplete', node });
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
