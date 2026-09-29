import { useEffect, useRef } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Histogram } from '../../analysis';
import { count } from '../format';
import { themeVersion, token } from './theme';

interface Props {
  hist: Histogram;
  format: (v: number) => string;
  /* Labelled vertical rules, e.g. percentiles. */
  rules?: { label: string; value: number }[];
  height?: number;
}

const decades = (_: uPlot, t: number[]) => t.map((v) => (Number.isInteger(Math.log10(v)) ? v : null));

/* Bar chart of a histogram, with a log count axis so tails stay visible. */
export function HistogramChart({ hist, format, rules = [], height = 200 }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void themeVersion.value;
    const root = el.current!;
    const { edges, counts } = hist;
    const x = Array.from(counts, (_, i) => (edges[i] + edges[i + 1]) / 2);
    const y = Array.from(counts, (c) => (c > 0 ? c : null));
    const width = edges[1] - edges[0];
    const grid = token('--grid');
    const axis = {
      stroke: token('--ink-2'),
      grid: { stroke: grid, width: 1 },
      ticks: { stroke: grid, width: 1 },
    };
    const fill = token('--series-1');

    const u = new uPlot(
      {
        width: root.clientWidth,
        height,
        scales: {
          x: { time: false, range: () => [edges[0], edges[edges.length - 1]] },
          y: { distr: 3 },
        },
        axes: [
          { ...axis, values: (_, t) => t.map(format) },
          {
            ...axis,
            size: 60,
            filter: decades,
            grid: { ...axis.grid, filter: decades },
            ticks: { ...axis.ticks, filter: decades },
            values: (_, t) => t.map((v) => (v == null ? '' : count(v))),
          },
        ],
        cursor: { y: false, drag: { x: false, y: false } },
        legend: { live: true },
        series: [
          {
            label: 'Bin',
            value: (_, v) => (v == null ? '–' : `${format(v - width / 2)} – ${format(v + width / 2)}`),
          },
          {
            label: 'Cycles',
            fill,
            stroke: fill,
            width: 0,
            paths: uPlot.paths.bars!({ size: [1, Infinity], gap: 1 }),
            points: { show: false },
            value: (_, v) => (v == null ? '0' : count(v)),
          },
        ],
        hooks: {
          draw: [
            (u) => {
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = token('--ink');
              ctx.fillStyle = token('--ink');
              ctx.font = `${12 * devicePixelRatio}px system-ui, sans-serif`;
              ctx.lineWidth = devicePixelRatio;
              ctx.textAlign = 'left';
              for (const r of rules) {
                const px = Math.round(u.valToPos(r.value, 'x', true)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(px, u.bbox.top);
                ctx.lineTo(px, u.bbox.top + u.bbox.height);
                ctx.stroke();
                ctx.fillText(` ${r.label}`, px, u.bbox.top + 12 * devicePixelRatio);
              }
              ctx.restore();
            },
          ],
        },
      },
      [x, y] as uPlot.AlignedData,
      root,
    );

    const ro = new ResizeObserver(() => u.setSize({ width: root.clientWidth, height }));
    ro.observe(root);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [hist, rules, themeVersion.value]);

  return <div ref={el} class="chart" />;
}
