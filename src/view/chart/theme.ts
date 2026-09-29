import { signal } from '@preact/signals';

/* Bumped when the colour scheme changes, so charts can re-read tokens. */
export const themeVersion = signal(0);

const mq = matchMedia('(prefers-color-scheme: dark)');
mq.addEventListener('change', () => themeVersion.value++);

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Resolves `var(--x)` references for canvas drawing. */
export function color(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  return m ? token(m[1]) : c;
}

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
