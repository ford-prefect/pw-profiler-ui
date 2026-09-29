import type { Anomaly, AnomalyKind, Blocked } from '../analysis';
import { count, pct, seconds, us } from './format';

export const KINDS: { kind: AnomalyKind; label: string; hint: string }[] = [
  {
    kind: 'incomplete',
    label: 'incomplete cycles',
    hint: 'The graph had not finished by the next wakeup (a graph xrun)',
  },
  { kind: 'xrun', label: 'reported xruns', hint: 'xrun counters that went up outside incomplete cycles' },
  { kind: 'overrun', label: 'overruns', hint: 'Graph time over the cycle budget' },
  { kind: 'period', label: 'off-period wakeups', hint: 'Driver wakeup off the expected period' },
];

export const KIND_LABEL: Record<AnomalyKind, string> = {
  incomplete: 'incomplete',
  xrun: 'xrun',
  overrun: 'overrun',
  period: 'off-period',
};

const STATUS: Record<string, string> = {
  'not-triggered': 'not triggered',
  triggered: 'never woke up',
  awake: 'did not finish',
};

export function blockedText(b: Blocked): string {
  return `${STATUS[b.status] ?? b.status}${b.joined ? ', just joined' : ''}`;
}

/* What the anomaly concerns, for a table column. */
export function subject(a: Anomaly): string {
  switch (a.kind) {
    case 'incomplete':
      return a.blocked.map((b) => b.node.name).join(', ') || 'unknown';
    case 'xrun':
      return a.node?.name ?? a.clock ?? 'driver';
    default:
      return 'driver';
  }
}

export function detail(a: Anomaly, times: ArrayLike<number>): string {
  switch (a.kind) {
    case 'incomplete': {
      const parts = a.blocked.map(blockedText);
      if (Number.isFinite(a.completion)) parts.push(`completed at +${us(a.completion)}`);
      return parts.join('; ');
    }
    case 'xrun':
      return a.count > 1
        ? `+${count(a.increase)} over ${seconds(times[a.end - 1] - times[a.cycle])}`
        : `+${count(a.increase)}`;
    case 'overrun':
      return `${pct(a.load)} of budget`;
    case 'period':
      return `${pct(a.ratio)} of expected`;
  }
}
