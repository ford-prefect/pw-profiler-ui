import { useMemo } from 'preact/hooks';
import { cycleBreakdown, topCycles } from '../analysis';
import { detail, KIND_LABEL, subject } from './anomaly';
import { count, pct, seconds, us } from './format';
import { driver, metrics, range, selectedCycle, times, visibleAnomalies } from './state';

const LIMIT = 100;

export function Outliers() {
  const d = driver.value!;
  const m = metrics.value!;
  const r = range.value;
  const t = times.value;
  const sel = selectedCycle.value;
  const list = visibleAnomalies.value;

  /* For each slow cycle, the node with the largest scheduling or processing span. */
  const slowest = useMemo(
    () =>
      topCycles(m.busy, 15, r).map((i) => {
        let top: { name: string; what: string; span: number } | null = null;
        for (const row of cycleBreakdown(d, i).rows) {
          if (row.driver) continue;
          for (const [what, span] of [
            ['scheduling', row.awake - row.signal],
            ['processing', row.finish - row.awake],
          ] as const) {
            if (span > (top?.span ?? -1)) top = { name: row.node.name, what, span };
          }
        }
        return { i, top };
      }),
    [d, m, r],
  );

  return (
    <section>
      <h2>Outliers</h2>
      <p class="hint">Within the visible range. Click a row to inspect the cycle.</p>
      <div class="columns">
        <div>
          <h3>Slowest cycles</h3>
          <div class="table-wrap">
            <table class="pick">
              <thead>
                <tr>
                  <th class="num">Time</th>
                  <th class="num">Graph time</th>
                  <th class="num">Budget</th>
                  <th class="num">Largest delay</th>
                  <th>Node</th>
                </tr>
              </thead>
              <tbody>
                {slowest.map(({ i, top }) => (
                  <tr key={i} class={i === sel ? 'selected' : ''} onClick={() => (selectedCycle.value = i)}>
                    <td class="num">{seconds(t[i])}</td>
                    <td class="num">{us(m.busy[i])}</td>
                    <td class="num">{pct(m.load[i])}</td>
                    <td class="num">{top ? `${top.what} ${us(top.span)}` : '–'}</td>
                    <td class="name" title={top?.name}>{top?.name ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>Anomalies</h3>
          {list.length === 0 ? (
            <p class="ok-note">
              <span class="status-icon" aria-hidden="true">
                ✓
              </span>
              None detected.
            </p>
          ) : (
            <div class="table-wrap">
              <table class="pick">
                <thead>
                  <tr>
                    <th class="num">Time</th>
                    <th>Kind</th>
                    <th>Node</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, LIMIT).map((a, k) => (
                    <tr
                      key={k}
                      class={a.cycle === sel ? 'selected' : ''}
                      onClick={() => (selectedCycle.value = a.cycle)}
                    >
                      <td class="num">{seconds(t[a.cycle])}</td>
                      <td class={`status-${a.kind}`}>
                        <span class="status-icon" aria-hidden="true">
                          ▲
                        </span>
                        {KIND_LABEL[a.kind]}
                      </td>
                      <td class="name" title={subject(a)}>
                        {subject(a)}
                      </td>
                      <td>{detail(a, t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.length > LIMIT && (
                <p class="muted">
                  {count(list.length - LIMIT)} more; zoom in to narrow the list.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
