import uPlot from 'uplot';
import { visibleSpan, zoom } from '../state';

/*
 * Options shared by charts over capture time: the x scale follows the
 * visible span, the cursor is synced, and dragging zooms all of them.
 */
export function timeAxisOptions(axis: uPlot.Axis): Pick<uPlot.Options, 'cursor'> & {
  x: uPlot.Scale;
  xAxis: uPlot.Axis;
  setSelect: (u: uPlot) => void;
} {
  return {
    x: {
      time: false,
      range: () => {
        const s = visibleSpan.peek();
        return [s.min, s.max];
      },
    },
    xAxis: { ...axis, values: (_, ticks) => ticks.map((t) => `${t}s`) },
    cursor: {
      sync: { key: 'timeline' },
      y: false,
      drag: { x: true, y: false, setScale: false },
      bind: { dblclick: () => () => null },
    },
    setSelect: (u) => {
      const { left, width } = u.select;
      if (width < 2) return;
      zoom.value = { min: u.posToVal(left, 'x'), max: u.posToVal(left + width, 'x') };
      u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    },
  };
}

/* Calls `onClick` for clicks that are not drags; double-click resets zoom. */
export function bindTimeEvents(u: uPlot, onClick: (e: MouseEvent) => void): () => void {
  let down = { x: 0, y: 0 };
  const onDown = (e: MouseEvent) => (down = { x: e.clientX, y: e.clientY });
  const click = (e: MouseEvent) => {
    if (Math.abs(e.clientX - down.x) > 3 || Math.abs(e.clientY - down.y) > 3) return;
    onClick(e);
  };
  const onDbl = () => (zoom.value = null);
  u.over.addEventListener('mousedown', onDown);
  u.over.addEventListener('click', click);
  u.over.addEventListener('dblclick', onDbl);
  return () => {
    u.over.removeEventListener('mousedown', onDown);
    u.over.removeEventListener('click', click);
    u.over.removeEventListener('dblclick', onDbl);
  };
}
