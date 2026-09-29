import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { range, selectedCycle, times, zoom } from '../state';
import { breakAt, decimate } from './decimate';
import { color, themeVersion, token } from './theme';

export interface TimeSeries {
  label: string;
  values: ArrayLike<number>;
  color: string;
  width?: number;
  /* Draw as markers only. */
  markers?: boolean;
}

interface Props {
  series: TimeSeries[];
  format: (v: number) => string;
  height?: number;
  /* Fit the y axis to the first series only. */
  fitFirst?: boolean;
  /* Non-zero at cycles that follow a gap; lines are broken there. */
  breaks?: ArrayLike<number>;
}

/*
 * Time-series chart over the current driver's cycles. All instances share
 * the zoom, cursor and selected cycle.
 */
export function TimeChart({ series, format, height = 200, fitFirst = false, breaks }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void themeVersion.value;
    const root = el.current!;
    let index: ArrayLike<number> = [];
    const ink2 = token('--ink-2');
    const grid = token('--grid');
    const axis = { stroke: ink2, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } };

    const opts: uPlot.Options = {
      width: root.clientWidth,
      height,
      scales: {
        x: { time: false },
        y: fitFirst
          ? {
              range: (u) => {
                let max = 0;
                const y = u.data[1];
                for (let i = 0; i < y.length; i++) if ((y[i] ?? 0) > max) max = y[i]!;
                return [0, max * 1.1 || 1];
              },
            }
          : {},
      },
      axes: [
        { ...axis, values: (_, ticks) => ticks.map((t) => `${t}s`) },
        { ...axis, size: 80, values: (_, ticks) => ticks.map(format) },
      ],
      cursor: {
        sync: { key: 'timeline' },
        y: false,
        drag: { x: true, y: false, setScale: false },
        bind: { dblclick: () => () => null },
      },
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
        setSelect: [
          (u) => {
            const { left, width } = u.select;
            if (width < 2) return;
            zoom.value = { min: u.posToVal(left, 'x'), max: u.posToVal(left + width, 'x') };
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          },
        ],
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

    let down = { x: 0, y: 0 };
    const onDown = (e: MouseEvent) => (down = { x: e.clientX, y: e.clientY });
    const onClick = (e: MouseEvent) => {
      if (Math.abs(e.clientX - down.x) > 3 || Math.abs(e.clientY - down.y) > 3) return;
      const i = u.cursor.idx;
      if (i != null && i < index.length) selectedCycle.value = index[i];
    };
    const onDbl = () => (zoom.value = null);
    u.over.addEventListener('mousedown', onDown);
    u.over.addEventListener('click', onClick);
    u.over.addEventListener('dblclick', onDbl);

    const ro = new ResizeObserver(() => {
      u.setSize({ width: root.clientWidth, height });
      update();
    });
    ro.observe(root);

    return () => {
      ro.disconnect();
      stopData();
      stopSel();
      u.destroy();
    };
  }, [series, breaks, themeVersion.value]);

  return <div ref={el} class="chart" />;
}
