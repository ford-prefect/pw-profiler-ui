import type { Driver } from '../model';
import { cycleMetrics } from './metrics';

export interface Span {
  /* Cycle indices, end exclusive. */
  first: number;
  end: number;
  /* Times of the first and last cycle, in the units of `times`. */
  start: number;
  stop: number;
  /* Most followers in any cycle of the span. */
  followers: number;
}

/* Stretches of time a driver ran continuously, split at gaps in its record. */
export function activeSpans(driver: Driver, times: ArrayLike<number>): Span[] {
  const gap = cycleMetrics(driver).gap;
  const spans: Span[] = [];
  let cur: Span | null = null;
  for (let i = 0; i < driver.cycleCount; i++) {
    if (!cur || gap[i]) {
      cur = { first: i, end: i + 1, start: times[i], stop: times[i], followers: 0 };
      spans.push(cur);
    }
    cur.end = i + 1;
    cur.stop = times[i];
    cur.followers = Math.max(cur.followers, driver.followerCount(i));
  }
  return spans;
}
