import { useMemo } from 'preact/hooks';
import { histogram } from '../analysis';
import { HistogramChart } from './chart/HistogramChart';
import { us } from './format';
import { busy, metrics, range } from './state';

export function Distribution() {
  const m = metrics.value!;
  const b = busy.value!;
  const r = range.value;

  const [hist, rules] = useMemo(
    () => [
      histogram(m.busy, { bins: 120, min: 0, max: b.max || 1, range: r }),
      [
        { label: 'p50', value: b.p50 },
        { label: 'p99', value: b.p99 },
      ],
    ],
    [m, b, r],
  );

  return (
    <section>
      <h2>Graph time distribution</h2>
      <p class="hint">Cycles per graph processing time, log scale.</p>
      <HistogramChart hist={hist} format={us} rules={rules} />
    </section>
  );
}
