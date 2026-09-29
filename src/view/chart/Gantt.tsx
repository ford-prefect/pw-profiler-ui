import type { CycleBreakdown, CycleRow } from '../../analysis';
import { us } from '../format';

interface Props {
  cycle: CycleBreakdown;
  /* µs at the right edge, shared between charts being compared. */
  scale: number;
}

function ticks(max: number): number[] {
  const step0 = max / 5;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const out = [];
  for (let t = 0; t <= max; t += step) out.push(t);
  return out;
}

function describe(r: CycleRow): string {
  if (Number.isNaN(r.finish)) return `${r.node.name} (${r.node.id}): ${r.status}`;
  return (
    `${r.node.name} (${r.node.id})\n` +
    `signalled +${us(r.signal)}, awake +${us(r.awake)}, finished +${us(r.finish)}\n` +
    `scheduling ${us(r.awake - r.signal)}, processing ${us(r.finish - r.awake)}`
  );
}

/* Per-node waiting (signal -> awake) and running (awake -> finish) spans. */
export function Gantt({ cycle, scale }: Props) {
  const x = (v: number) => `${(v / scale) * 100}%`;
  const budget = cycle.budget <= scale ? cycle.budget : null;

  return (
    <div class="gantt">
      {cycle.rows.map((r) => (
        <div class={`gantt-row ${r.driver ? 'driver' : ''}`} key={r.node.index} title={describe(r)}>
          <div class="gantt-label">
            {r.node.name} <span class="muted">{r.node.id}</span>
          </div>
          <div class="gantt-track">
            {Number.isNaN(r.finish) ? (
              <span class="gantt-status">{r.status}</span>
            ) : (
              <>
                <span class="gantt-wait" style={{ left: x(r.signal), width: x(r.awake - r.signal) }} />
                <span class="gantt-run" style={{ left: x(r.awake), width: x(r.finish - r.awake) }} />
              </>
            )}
            {budget != null && <span class="gantt-budget" style={{ left: x(budget) }} />}
          </div>
        </div>
      ))}
      <div class="gantt-row axis">
        <div />
        <div class="gantt-track">
          {ticks(scale).map((t) => (
            <span class="gantt-tick" style={{ left: x(t) }} key={t}>
              {us(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
