import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { range, selectedCycle, times } from '../state';
import { breakAt, decimate } from './decimate';
import { color, font, themeVersion, token } from './theme';
import { bindTimeEvents, timeAxisOptions } from './timeAxis';

export interface TimeSeries {
  label: string;
  values: ArrayLike<number>;
  color: string;
  width?: number;
  /* Draw as markers only. */
  markers?: boolean;
  /* Leave out of the y range of charts with fitted y axes. */
  noFit?: boolean;
}

interface Props {
  series: TimeSeries[];
  format: (v: number) => string;
  height?: number;
  /* Fit the y axis from 0 to the series not marked noFit. */
  fit?: boolean;
  /* Non-zero at cycles that follow a gap; lines are broken there. */
  breaks?: ArrayLike<number>;
}

/*
 * Time-series chart over the current driver's cycles. All instances share
 * the zoom, cursor and selected cycle.
 */
export function TimeChart({ series, format, height = 200, fit = false, breaks }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void themeVersion.value;
    const root = el.current!;
    let index: ArrayLike<number> = [];
    const ink2 = token('--ink-2');
    const grid = token('--grid');
    const axis = { font: font(12), stroke: ink2, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } };
    const time = timeAxisOptions(axis);

    const opts: uPlot.Options = {
      width: root.clientWidth,
      height,
      scales: {
        x: time.x,
        y: fit
          ? {
              range: (u) => {
                let max = 0;
                series.forEach((s, k) => {
                  if (s.noFit) return;
                  const y = u.data[k + 1];
                  for (let i = 0; i < y.length; i++) if ((y[i] ?? 0) > max) max = y[i]!;
                });
                return [0, max * 1.1 || 1];
              },
            }
          : {},
      },
      axes: [
        time.xAxis,
        { ...axis, size: 80, values: (_, ticks) => ticks.map(format) },
      ],
      cursor: time.cursor,
      legend: { live: true },
      series: [
        { label: 'Time', value: (_, v) => (v == null ? '–' : `${v.toFixed(3)} s`) },
        ...series.map((s): uPlot.Series => ({
          label: s.label,
          stroke: color(s.color),
          width: s.width ?? 1,
          value: (_, v) => (v == null || Number.isNaN(v) ? '–' : format(v)),
          ...(s.markers
            ? {
                paths: () => null,
                points: { show: true, size: 8, fill: color(s.color), stroke: token('--surface'), width: 2 },
              }
            : { points: { show: false } }),
        })),
      ],
      hooks: {
        setSelect: [time.setSelect],
        draw: [
          (u) => {
            const c = selectedCycle.peek();
            if (c == null) return;
            const t = times.peek()[c];
            if (t == null) return;
            const x = u.valToPos(t, 'x', true);
            if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
            u.ctx.save();
            u.ctx.strokeStyle = token('--ink');
            u.ctx.lineWidth = 1;
            u.ctx.beginPath();
            u.ctx.moveTo(x, u.bbox.top);
            u.ctx.lineTo(x, u.bbox.top + u.bbox.height);
            u.ctx.stroke();
            u.ctx.restore();
          },
        ],
      },
    };

    const u = new uPlot(opts, [[]], root);

    const update = () => {
      const { start, end } = range.value;
      const buckets = Math.max(100, Math.round(u.bbox.width / devicePixelRatio));
      let d = decimate(
        times.value,
        series.map((s) => s.values),
        start,
        end,
        buckets,
      );
      if (breaks) d = breakAt(d, breaks);
      index = d.index;
      /* uPlot treats null, not NaN, as missing. */
      const ys = d.ys.map((y) => Array.from(y, (v) => (Number.isNaN(v) ? null : v)));
      u.setData([d.x, ...ys] as uPlot.AlignedData);
    };
    const stopData = effect(update);
    const stopSel = effect(() => {
      void selectedCycle.value;
      u.redraw(false, false);
    });

    const unbind = bindTimeEvents(u, () => {
      const i = u.cursor.idx;
      if (i != null && i < index.length) selectedCycle.value = index[i];
    });

    const ro = new ResizeObserver(() => {
      u.setSize({ width: root.clientWidth, height });
      update();
    });
    ro.observe(root);

    return () => {
      ro.disconnect();
      unbind();
      stopData();
      stopSel();
      u.destroy();
    };
  }, [series, breaks, themeVersion.value]);

  return <div ref={el} class="chart" />;
}
