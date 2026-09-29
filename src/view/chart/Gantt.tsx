import type { Blocked, CycleBreakdown, CycleRow } from '../../analysis';
import { blockedText } from '../anomaly';
import { us } from '../format';

interface Props {
  cycle: CycleBreakdown;
  /* µs at the right edge, shared between charts being compared. */
  scale: number;
  /* Nodes that held up an incomplete run, by node index. */
  blocked?: Map<number, Blocked>;
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
  const name = `${r.node.name} (${r.node.id})${r.async ? ', async' : ''}`;
  if (!r.ran) return `${name}: ${r.status === 'finished' ? 'did not run this cycle' : r.status}`;
  return (
    `${name}\n` +
    `signalled +${us(r.signal)}, awake +${us(r.awake)}, finished +${us(r.finish)}\n` +
    `scheduling ${us(r.awake - r.signal)}, processing ${us(r.finish - r.awake)}`
  );
}

/* Per-node waiting (signal -> awake) and running (awake -> finish) spans. */
export function Gantt({ cycle, scale, blocked }: Props) {
  const x = (v: number) => `${(v / scale) * 100}%`;
  const budget = cycle.budget <= scale ? cycle.budget : null;

  return (
    <div class="gantt">
      {cycle.rows.map((r) => (
        <div
          class={`gantt-row ${r.driver ? 'driver' : ''} ${blocked?.has(r.node.index) ? 'blocked' : ''}`}
          key={r.node.index}
          title={describe(r)}
        >
          <div class="gantt-label">
            {r.node.name} <span class="muted">{r.node.id}</span>
            {r.async && <span class="tag">async</span>}
          </div>
          <div class="gantt-track">
            {Number.isNaN(r.finish) ? (
              <span class="gantt-status">
                {blocked?.has(r.node.index)
                  ? `${blockedText(blocked.get(r.node.index)!)}: held up the graph`
                  : r.status === 'finished'
                    ? 'did not run this cycle'
                    : r.status}
              </span>
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
