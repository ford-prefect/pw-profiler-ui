import { batch, computed, signal } from '@preact/signals';
import {
  clientStats,
  clockConfigs,
  cycleMetrics,
  cycleTimes,
  findAnomalies,
  summarize,
  type Range,
} from '../analysis';
import type { Profile } from '../model';

/* UI state. Model entities are referenced by index. */

export const profile = signal<Profile | null>(null);
export const fileName = signal('');
export const loading = signal<{ bytes: number; total: number } | null>(null);
export const error = signal<string | null>(null);

export const driverIndex = signal(0);
/* Visible time span in seconds from capture start; null for everything. */
export const zoom = signal<{ min: number; max: number } | null>(null);
export const selectedCycle = signal<number | null>(null);
/* Followers shown in client charts, by node index, with their colour slot. */
export const selectedNodes = signal<Map<number, number>>(new Map());
export type ClientMetric = 'duration' | 'latency' | 'end';
export const clientMetric = signal<ClientMetric>('duration');

export const MAX_SELECTED = 8;

export function setProfile(p: Profile, name: string) {
  profile.value = p;
  fileName.value = name;
  zoom.value = null;
  /* The driver with the most cycles is most likely the one of interest. */
  const busiest = p.drivers.reduce((best, d, i) => (d.cycleCount > p.drivers[best].cycleCount ? i : best), 0);
  selectDriver(busiest);
}

export function selectDriver(i: number) {
  batch(() => {
    driverIndex.value = i;
    selectedCycle.value = null;
    const top = [...clientStats(driver.value!)].sort((a, b) => b.share - a.share).slice(0, 3);
    selectedNodes.value = new Map(top.map((c, slot) => [c.node.index, slot]));
  });
}

export function toggleNode(index: number) {
  const m = new Map(selectedNodes.value);
  if (m.has(index)) {
    m.delete(index);
  } else {
    if (m.size >= MAX_SELECTED) return;
    const used = new Set(m.values());
    let slot = 0;
    while (used.has(slot)) slot++;
    m.set(index, slot);
  }
  selectedNodes.value = m;
}

/* Derived data */

export const driver = computed(() => profile.value?.drivers[driverIndex.value] ?? null);

export const times = computed(() => {
  const d = driver.value;
  return d ? cycleTimes(d, profile.value!.start) : new Float64Array();
});

export const metrics = computed(() => {
  const d = driver.value;
  return d ? cycleMetrics(d) : null;
});

function lowerBound(a: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* Visible time span in seconds: the zoom, or the whole capture. */
export const visibleSpan = computed(() => {
  const p = profile.value;
  return zoom.value ?? { min: 0, max: p ? (p.end - p.start) / 1e9 : 1 };
});

/* Cycles within the zoomed span. */
export const range = computed<Range>(() => {
  const t = times.value;
  const z = zoom.value;
  if (!z) return { start: 0, end: t.length };
  return { start: lowerBound(t, z.min), end: lowerBound(t, z.max + 1e-12) };
});

export const busy = computed(() => (metrics.value ? summarize(metrics.value.busy, range.value) : null));
export const load = computed(() => (metrics.value ? summarize(metrics.value.load, range.value) : null));
export const clocks = computed(() => (driver.value ? clockConfigs(driver.value, range.value) : []));

export const anomalies = computed(() => (driver.value ? findAnomalies(profile.value!, driver.value) : []));
export const visibleAnomalies = computed(() => {
  const { start, end } = range.value;
  return anomalies.value.filter((a) => a.cycle >= start && a.cycle < end);
});

export const clients = computed(() => (driver.value ? clientStats(driver.value, range.value) : []));
