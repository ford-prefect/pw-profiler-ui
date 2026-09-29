import { computed, signal } from '@preact/signals';
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

export function setProfile(p: Profile, name: string) {
  profile.value = p;
  fileName.value = name;
  driverIndex.value = 0;
  zoom.value = null;
  selectedCycle.value = null;
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

export const anomalies = computed(() => (driver.value ? findAnomalies(driver.value) : []));
export const visibleAnomalies = computed(() => {
  const { start, end } = range.value;
  return anomalies.value.filter((a) => a.cycle >= start && a.cycle < end);
});

export const clients = computed(() => (driver.value ? clientStats(driver.value, range.value) : []));
