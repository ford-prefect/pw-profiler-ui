import type { Driver, Node } from '../model';
import { asyncReports, cycleMetrics } from './metrics';
import { summarize, type Summary } from './stats';
import type { Range } from './range';

export interface CycleRow {
  node: Node;
  driver: boolean;
  async: boolean;
  status: string;
  /* Whether it ran in this cycle; a node can report finished from an earlier run. */
  ran: boolean;
  /* µs from driver signal; NaN unless the node finished. */
  signal: number;
  awake: number;
  finish: number;
}

export interface CycleBreakdown {
  index: number;
  busy: number;
  budget: number;
  /* Rows in order of signal time, driver last as it finishes the cycle. */
  rows: CycleRow[];
}

/* Timeline of one cycle relative to its driver signal. */
export function cycleBreakdown(driver: Driver, index: number): CycleBreakdown {
  const c = driver.cycle(index);
  const m = cycleMetrics(driver);
  const t0 = c.driver.signal;
  const stale = m.stale[index] === 1;
  const rel = (v: number, ok: boolean) => (ok && !stale && v >= t0 ? (v - t0) / 1e3 : NaN);

  /* Async followers' runs in this cycle are in the next cycle's report. */
  const next = index + 1 < driver.cycleCount ? driver.cycle(index + 1) : null;
  const followers = c.followers.map((b) => {
    if (asyncReports(driver, b.node)[index]) {
      const r = next?.followers.find((f) => f.node === b.node);
      const ok = !!r && asyncReports(driver, b.node)[index + 1] === 1 && r.signal >= t0 && r.finish >= r.awake && r.awake >= r.signal;
      return {
        node: b.node,
        driver: false,
        async: true,
        status: ok ? 'finished' : b.status,
        signal: rel(r?.signal ?? NaN, ok),
        awake: rel(r?.awake ?? NaN, ok),
        finish: rel(r?.finish ?? NaN, ok),
      };
    }
    const ok = b.status === 'finished';
    return {
      node: b.node,
      driver: false,
      async: false,
      status: b.status,
      signal: rel(b.signal, ok),
      awake: rel(b.awake, ok),
      finish: rel(b.finish, ok),
    };
  });
  const key = (v: number) => (Number.isNaN(v) ? Infinity : v);
  followers.sort((a, b) => key(a.signal) - key(b.signal) || key(a.awake) - key(b.awake));
  const ok = c.driver.status === 'finished';

  const driverRow = {
    node: c.driver.node,
    driver: true,
    async: false,
    status: c.driver.status,
    signal: rel(c.driver.signal, ok),
    awake: rel(c.driver.awake, ok),
    finish: rel(c.driver.finish, ok),
  };
  return {
    index,
    busy: m.busy[index],
    budget: m.budget[index],
    rows: [...followers, driverRow].map((r) => ({ ...r, ran: Number.isFinite(r.finish) })),
  };
}

/* The cycle in range whose graph time is closest to the median. */
export function typicalCycle(driver: Driver, range?: Range): { index: number; busy: Summary } | null {
  const busy = cycleMetrics(driver).busy;
  const s = summarize(busy, range);
  if (!s.n) return null;
  const start = range?.start ?? 0;
  const end = range?.end ?? busy.length;
  let best = -1;
  for (let i = start; i < end; i++) {
    if (Number.isFinite(busy[i]) && (best < 0 || Math.abs(busy[i] - s.p50) < Math.abs(busy[best] - s.p50))) best = i;
  }
  return { index: best, busy: s };
}
