import { useEffect, useMemo } from 'preact/hooks';
import { cycleBreakdown, typicalCycle } from '../analysis';
import { detail, KIND_LABEL, subject } from './anomaly';
import { Gantt } from './chart/Gantt';
import { pct, seconds, us } from './format';
import { anomalies, driver, range, selectedCycle, times } from './state';

function step(delta: number) {
  const n = driver.value!.cycleCount;
  const c = selectedCycle.value;
  if (c != null) selectedCycle.value = Math.max(0, Math.min(n - 1, c + delta));
}

function nextAnomaly(dir: 1 | -1) {
  const c = selectedCycle.value ?? -1;
  const list = anomalies.value;
  const a = dir > 0 ? list.find((a) => a.cycle > c) : list.findLast((a) => a.cycle < c);
  if (a) selectedCycle.value = a.cycle;
}

export function CycleView() {
  const d = driver.value!;
  const index = selectedCycle.value!;
  const r = range.value;

  const [sel, typical] = useMemo(() => {
    const sel = cycleBreakdown(d, index);
    const t = typicalCycle(d, r);
    if (!t) return [sel, null];
    /* Match the selected cycle's row order for comparison. */
    const typ = cycleBreakdown(d, t.index);
    const order = new Map(sel.rows.map((row, i) => [row.node.index, i]));
    typ.rows.sort((a, b) => (order.get(a.node.index) ?? Infinity) - (order.get(b.node.index) ?? Infinity));
    return [sel, typ];
  }, [d, index, r]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Escape') selectedCycle.value = null;
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const finish = (c: typeof sel | null) =>
    c ? Math.max(0, ...c.rows.map((row) => row.finish).filter(Number.isFinite)) : 0;
  const scale = Math.max(finish(sel), finish(typical)) * 1.05 || 1;
  const cycleAnomalies = anomalies.value.filter((a) => a.cycle === index);

  return (
    <section>
      <div class="section-head">
        <h2>
          Cycle {index} at {seconds(times.value[index])}
        </h2>
        <span class="spacer" />
        <button class="button" onClick={() => nextAnomaly(-1)} title="Previous anomaly">
          ⇤ Anomaly
        </button>
        <button class="button" onClick={() => step(-1)} title="Previous cycle (←)">
          ←
        </button>
        <button class="button" onClick={() => step(1)} title="Next cycle (→)">
          →
        </button>
        <button class="button" onClick={() => nextAnomaly(1)} title="Next anomaly">
          Anomaly ⇥
        </button>
        <button class="button" onClick={() => (selectedCycle.value = null)} title="Close (Esc)">
          ✕
        </button>
      </div>
      <p class="hint">
        Graph time {us(sel.busy)}
        {Number.isFinite(sel.budget) && ` (${pct(sel.busy / sel.budget)} of ${us(sel.budget)} budget)`}.
        {cycleAnomalies.length > 0 &&
          ` Anomalies: ${cycleAnomalies.map((a) => `${KIND_LABEL[a.kind]} (${subject(a)}: ${detail(a, times.value)})`).join(', ')}.`}{' '}
        Light bars are scheduling latency, dark bars processing.
        {sel.budget > scale && ` The budget line is off-scale.`}
      </p>
      <h3>Selected</h3>
      <Gantt cycle={sel} scale={scale} />
      {typical && (
        <>
          <h3>
            Typical: cycle {typical.index}, graph time {us(typical.busy)}
          </h3>
          <Gantt cycle={typical} scale={scale} />
        </>
      )}
    </section>
  );
}
