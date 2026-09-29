import type { Driver, Node } from '../model';
import { cycleMetrics, nodeMetrics } from './metrics';
import type { Range } from './range';
import { summarize, type Summary } from './stats';

export interface ClientStats {
  node: Node;
  /* Cycles in which the node finished. */
  cycles: number;
  duration: Summary;
  latency: Summary;
  end: Summary;
  /*
   * Node processing time over driver busy time. Nodes may run in parallel,
   * so shares can sum to more than 1.
   */
  share: number;
}

export function clientStats(driver: Driver, range?: Range): ClientStats[] {
  const busy = summarize(cycleMetrics(driver).busy, range).sum;
  return driver.followers.map((node) => {
    const m = nodeMetrics(driver, node);
    const duration = summarize(m.duration, range);
    return {
      node,
      cycles: duration.n,
      duration,
      latency: summarize(m.latency, range),
      end: summarize(m.end, range),
      share: busy > 0 ? duration.sum / busy : NaN,
    };
  });
}
