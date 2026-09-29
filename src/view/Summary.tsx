import type { AnomalyKind } from '../analysis';
import { count, pct, seconds, us } from './format';
import { busy, clocks, driver, load, profile, range, times, visibleAnomalies } from './state';

const KINDS: { kind: AnomalyKind; label: string }[] = [
  { kind: 'xrun', label: 'xruns' },
  { kind: 'overrun', label: 'overruns' },
  { kind: 'incomplete', label: 'unfinished nodes' },
  { kind: 'period', label: 'off-period wakeups' },
];

const ofBudget = (v: number) => (Number.isFinite(v) ? `${pct(v)} of budget` : undefined);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div class="tile">
      <div class="tile-label">{label}</div>
      <div class="tile-value">{value}</div>
      {sub && <div class="tile-sub">{sub}</div>}
    </div>
  );
}

export function Summary() {
  const p = profile.value!;
  const d = driver.value!;
  const r = range.value;
  const t = times.value;
  const b = busy.value!;
  const l = load.value!;
  const c = clocks.value[0];
  const span = r.end > r.start ? t[r.end - 1] - t[r.start] : 0;

  const byKind = new Map<AnomalyKind, number>();
  for (const a of visibleAnomalies.value) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);

  const diag = p.diagnostics;
  const warnings = [
    diag.malformed && `${count(diag.malformed)} malformed lines`,
    diag.incomplete && `${count(diag.incomplete)} incomplete samples`,
    ...Object.entries(diag.unknownTypes).map(([k, n]) => `${count(n)} unknown "${k}" records`),
  ].filter(Boolean);

  return (
    <section>
      <div class="tiles">
        <Tile label="Span" value={seconds(span)} sub={`${count(r.end - r.start)} cycles`} />
        {c && (
          <Tile
            label="Quantum"
            value={us((c.duration * 1e6 * c.rate.num) / c.rate.denom)}
            sub={[
              `${c.duration} / ${c.rate.denom} Hz`,
              !c.fixedRate && 'no fixed rate',
              clocks.value.length > 1 && `${clocks.value.length} settings`,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        )}
        <Tile label="Graph time p50" value={us(b.p50)} sub={ofBudget(l.p50)} />
        <Tile label="Graph time p99" value={us(b.p99)} sub={ofBudget(l.p99)} />
        <Tile label="Graph time max" value={us(b.max)} sub={ofBudget(l.max)} />
        <div class="tile">
          <div class="tile-label">Anomalies</div>
          <ul class="anomaly-counts">
            {KINDS.map(({ kind, label }) => {
              const n = byKind.get(kind) ?? 0;
              return (
                <li key={kind} class={n ? `status-${kind}` : 'ok'}>
                  <span class="status-icon" aria-hidden="true">{n ? '▲' : '✓'}</span>
                  {count(n)} {label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p class="muted">
        Driver {d.node.name} ({d.node.id}), {d.followers.length} followers
      </p>
      {warnings.length > 0 && <p class="warning">Input problems: {warnings.join(', ')}</p>}
    </section>
  );
}
