import { useMemo } from 'preact/hooks';
import type { Anomaly, AnomalyKind } from '../analysis';
import { TimeChart, type TimeSeries } from './chart/TimeChart';
import { us } from './format';
import { anomalies, driver, metrics } from './state';

const MARKERS: { kind: AnomalyKind; label: string; color: string }[] = [
  { kind: 'incomplete', label: 'incomplete', color: 'var(--critical)' },
  { kind: 'xrun', label: 'xrun', color: 'var(--serious)' },
  { kind: 'overrun', label: 'overrun', color: 'var(--serious)' },
];

/* Dense marker series placing each anomaly at the height `at` gives it. */
function markers(kinds: AnomalyKind[], at: (a: Anomaly) => number, n: number) {
  const out = new Map<AnomalyKind, Float64Array>();
  for (const a of anomalies.value) {
    if (!kinds.includes(a.kind)) continue;
    let m = out.get(a.kind);
    if (!m) out.set(a.kind, (m = new Float64Array(n).fill(NaN)));
    m[a.cycle] = at(a);
  }
  return out;
}

export function Timeline() {
  const d = driver.value!;
  const m = metrics.value!;
  const a = anomalies.value;

  const [busy, period, delay] = useMemo(() => {
    const n = d.cycleCount;
    /* An incomplete cycle has no graph time; mark when the driver completed it. */
    const busyMarks = markers(
      ['incomplete', 'xrun', 'overrun'],
      (a) => (a.kind === 'incomplete' ? (Number.isFinite(a.completion) ? a.completion : m.budget[a.cycle]) : m.busy[a.cycle]),
      n,
    );
    const busy: TimeSeries[] = [
      { label: 'Graph time', values: m.busy, color: 'var(--series-1)' },
      { label: 'Budget', values: m.budget, color: 'var(--muted)', noFit: true },
      ...MARKERS.filter((k) => busyMarks.has(k.kind)).map((k) => ({
        label: k.label,
        values: busyMarks.get(k.kind)!,
        color: k.color,
        markers: true,
      })),
    ];
    const periodMarks = markers(['period'], (a) => m.period[a.cycle], n).get('period');
    const period: TimeSeries[] = [
      { label: 'Period', values: m.period, color: 'var(--series-1)' },
      { label: 'Expected', values: m.expectedPeriod, color: 'var(--muted)' },
      ...(periodMarks
        ? [{ label: 'off-period', values: periodMarks, color: 'var(--warning)', markers: true }]
        : []),
    ];
    const delay: TimeSeries[] = [{ label: 'Delay', values: m.delay, color: 'var(--series-1)' }];
    return [busy, period, delay];
  }, [d, m, a]);

  return (
    <section>
      <h2>Timeline</h2>
      <p class="hint">Drag to zoom, double-click to reset, click to inspect a cycle.</p>
      <h3>Graph processing time</h3>
      <p class="hint">
        Driver signal to driver finish. The budget line is drawn when in range. Incomplete cycles are
        marked where the driver completed them.
      </p>
      <TimeChart series={busy} format={us} fit breaks={m.gap} />
      <h3>Wakeup period</h3>
      <TimeChart series={period} format={us} height={140} breaks={m.gap} />
      <h3>Driver delay</h3>
      <p class="hint">Hardware pointer delay at wakeup.</p>
      <TimeChart series={delay} format={us} height={140} breaks={m.gap} />
    </section>
  );
}
