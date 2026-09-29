const nf = (digits: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const f0 = nf(0);
const f1 = nf(1);
const f2 = nf(2);

export function us(v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (Math.abs(v) >= 1000) return `${f2.format(v / 1000)} ms`;
  return `${f1.format(v)} µs`;
}

export function pct(v: number): string {
  return Number.isFinite(v) ? `${f1.format(v * 100)}%` : '–';
}

export function count(v: number): string {
  return f0.format(v);
}

export function seconds(v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (v < 60) return `${f2.format(v)} s`;
  const m = Math.floor(v / 60);
  return `${m}m ${f0.format(v - m * 60).padStart(2, '0')}s`;
}

export function bytes(v: number): string {
  return v >= 1 << 20 ? `${f1.format(v / (1 << 20))} MB` : `${f0.format(v / 1024)} kB`;
}
