import { useMemo } from 'preact/hooks';
import { activeSpans, cycleTimes } from '../analysis';
import { LaneChart } from './chart/LaneChart';
import { count } from './format';
import { driverIndex, profile, selectDriver } from './state';

export function Drivers() {
  const p = profile.value!;
  const current = driverIndex.value;

  /* Lanes in order of each driver's first activity. */
  const lanes = useMemo(
    () =>
      p.drivers
        .map((d, i) => {
          const spans = activeSpans(d, cycleTimes(d, p.start));
          const followers = Math.max(0, ...spans.map((s) => s.followers));
          return {
            index: i,
            label: `${d.node.name} (${d.node.id}) · ${count(d.cycleCount)} cycles, up to ${followers} followers`,
            spans,
          };
        })
        .sort((a, b) => a.spans[0].start - b.spans[0].start),
    [p],
  );
  const chartLanes = useMemo(
    () => lanes.map((l) => ({ label: l.label, spans: l.spans, active: l.index === current })),
    [lanes, current],
  );

  return (
    <section>
      <h2>Drivers</h2>
      <p class="hint">
        When each driver ran. Nodes can move between drivers, as driver or follower. Click a lane to
        select its driver.
      </p>
      <LaneChart lanes={chartLanes} onPick={(k) => selectDriver(lanes[k].index)} />
    </section>
  );
}
