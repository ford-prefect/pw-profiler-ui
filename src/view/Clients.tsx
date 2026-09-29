import { useSignal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { nodeMetrics, type ClientStats } from '../analysis';
import { SERIES } from './chart/theme';
import { TimeChart, type TimeSeries } from './chart/TimeChart';
import { count, pct, us } from './format';
import {
  clientMetric,
  clients,
  driver,
  MAX_SELECTED,
  metrics,
  selectedNodes,
  toggleNode,
  type ClientMetric,
} from './state';

const METRICS: { key: ClientMetric; label: string; hint: string }[] = [
  { key: 'duration', label: 'Processing', hint: 'Node awake to finish.' },
  { key: 'latency', label: 'Scheduling latency', hint: 'Node signalled to awake.' },
  { key: 'end', label: 'End time', hint: 'Driver signal to node finish.' },
];

type Column = {
  label: string;
  title?: string;
  get: (c: ClientStats) => number;
  format: (v: number) => string;
};

const COLUMNS: Column[] = [
  { label: 'Cycles', get: (c) => c.cycles, format: count },
  { label: 'Share', title: 'Processing time over graph time', get: (c) => c.share, format: pct },
  { label: 'Proc p50', get: (c) => c.duration.p50, format: us },
  { label: 'Proc p99', get: (c) => c.duration.p99, format: us },
  { label: 'Proc max', get: (c) => c.duration.max, format: us },
  { label: 'Sched p50', get: (c) => c.latency.p50, format: us },
  { label: 'Sched p99', get: (c) => c.latency.p99, format: us },
  { label: 'Sched max', get: (c) => c.latency.max, format: us },
  { label: 'End p99', title: 'Driver signal to node finish', get: (c) => c.end.p99, format: us },
];

export function Clients() {
  const d = driver.value!;
  const stats = clients.value;
  const sel = selectedNodes.value;
  const metric = clientMetric.value;
  const sort = useSignal({ col: 1, desc: true });

  const rows = useMemo(() => {
    const get = COLUMNS[sort.value.col].get;
    const key = (c: ClientStats) => (Number.isNaN(get(c)) ? -Infinity : get(c));
    return [...stats].sort((a, b) => (sort.value.desc ? key(b) - key(a) : key(a) - key(b)));
  }, [stats, sort.value]);
  const maxShare = Math.max(...stats.map((c) => c.share).filter(Number.isFinite), 0);

  const series = useMemo<TimeSeries[]>(
    () =>
      [...sel].map(([index, slot]) => {
        const node = d.followers.find((n) => n.index === index)!;
        return {
          label: `${node.name} (${node.id})`,
          values: nodeMetrics(d, node)[metric],
          color: SERIES[slot],
        };
      }),
    [d, sel, metric],
  );

  return (
    <section>
      <h2>Clients</h2>
      <p class="hint">
        Nodes may run in parallel, so shares can add up to more than 100%. The driver does not
        wait for async nodes. Select up to{' '}
        {MAX_SELECTED} rows to plot them.
      </p>
      <div class="table-wrap">
        <table class="clients">
          <thead>
            <tr>
              <th />
              <th class="name">Node</th>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.label}
                  title={c.title}
                  class={`num sortable ${sort.value.col === i ? 'sorted' : ''}`}
                  onClick={() =>
                    (sort.value = { col: i, desc: sort.value.col === i ? !sort.value.desc : true })
                  }
                >
                  {c.label}
                  {sort.value.col === i ? (sort.value.desc ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const slot = sel.get(c.node.index);
              return (
                <tr key={c.node.index} class={slot !== undefined ? 'selected' : ''} onClick={() => toggleNode(c.node.index)}>
                  <td>
                    <span
                      class="swatch"
                      style={{ background: slot !== undefined ? SERIES[slot] : 'transparent' }}
                    />
                  </td>
                  <td class="name" title={c.node.name}>
                    {c.node.name} <span class="muted">{c.node.id}</span>
                    {c.async && <span class="tag">async</span>}
                  </td>
                  {COLUMNS.map((col, i) => (
                    <td key={col.label} class="num">
                      {i === 1 && (
                        <span class="bar" style={{ width: `${(c.share / (maxShare || 1)) * 100}%` }} />
                      )}
                      <span class="val">{col.format(col.get(c))}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div class="tabs" role="tablist">
        {METRICS.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={metric === m.key}
            class={`tab ${metric === m.key ? 'active' : ''}`}
            onClick={() => (clientMetric.value = m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p class="hint">{METRICS.find((m) => m.key === metric)!.hint}</p>
      {series.length ? <TimeChart series={series} format={us} breaks={metrics.value!.gap} /> : <p class="muted">No clients selected.</p>}
    </section>
  );
}
