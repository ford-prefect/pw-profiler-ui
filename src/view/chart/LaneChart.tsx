import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { visibleSpan } from '../state';
import { font, themeVersion, token } from './theme';
import { bindTimeEvents, timeAxisOptions } from './timeAxis';

export interface Lane {
  label: string;
  spans: { start: number; stop: number }[];
  active: boolean;
}

interface Props {
  lanes: Lane[];
  onPick: (lane: number) => void;
}

const LANE = 28;

/* Labelled lanes of time spans on the shared time axis. */
export function LaneChart({ lanes, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void themeVersion.value;
    const root = el.current!;
    const grid = token('--grid');
    const axis = { font: font(12), stroke: token('--ink-2'), grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } };
    const time = timeAxisOptions(axis);
    const height = lanes.length * LANE + 50;

    const u = new uPlot(
      {
        width: root.clientWidth,
        height,
        scales: { x: time.x, y: { range: () => [0, 1] } },
        axes: [time.xAxis, { size: 80, values: () => [], grid: { show: false }, ticks: { show: false } }],
        cursor: { ...time.cursor, points: { show: false } },
        legend: { show: false },
        series: [{}, { scale: 'y' }],
        hooks: {
          setSelect: [time.setSelect],
          draw: [
            (u) => {
              const ctx = u.ctx;
              const dpr = devicePixelRatio;
              const { left, top, width } = u.bbox;
              const laneH = u.bbox.height / lanes.length;
              ctx.save();
              ctx.beginPath();
              ctx.rect(left, top, width, u.bbox.height);
              ctx.clip();
              ctx.font = font(11, dpr);
              ctx.textBaseline = 'top';
              ctx.textAlign = 'left';
              lanes.forEach((lane, k) => {
                const y = top + k * laneH;
                ctx.fillStyle = token(lane.active ? '--ink' : '--ink-2');
                ctx.fillText(lane.label, left + 4 * dpr, y + 2 * dpr);
                ctx.fillStyle = token(lane.active ? '--series-1' : '--muted');
                for (const s of lane.spans) {
                  const x0 = u.valToPos(s.start, 'x', true);
                  const x1 = u.valToPos(s.stop, 'x', true);
                  if (x1 < left || x0 > left + width) continue;
                  ctx.fillRect(x0, y + 16 * dpr, Math.max(x1 - x0, 2 * dpr), 8 * dpr);
                }
              });
              ctx.restore();
            },
          ],
        },
      },
      [[0], [null]] as uPlot.AlignedData,
      root,
    );

    const stop = effect(() => u.setScale('x', visibleSpan.value));
    const unbind = bindTimeEvents(u, (e) => {
      const k = Math.floor((e.offsetY / u.over.clientHeight) * lanes.length);
      if (k >= 0 && k < lanes.length) onPick(k);
    });
    const ro = new ResizeObserver(() => u.setSize({ width: root.clientWidth, height }));
    ro.observe(root);
    return () => {
      ro.disconnect();
      unbind();
      stop();
      u.destroy();
    };
  }, [lanes, themeVersion.value]);

  return <div ref={el} class="chart" />;
}
