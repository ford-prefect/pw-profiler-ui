import { signal } from '@preact/signals';

export type Theme = 'dark' | 'light';

const KEY = 'pw-profiler-ui:theme';

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export const theme = signal<Theme>(stored());
/* Bumped when the theme changes, so charts can re-read tokens. */
export const themeVersion = signal(0);

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
}
apply(theme.value);

export function setTheme(t: Theme) {
  theme.value = t;
  apply(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* Not persisted, e.g. in private windows. */
  }
  themeVersion.value++;
}

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Resolves `var(--x)` references for canvas drawing. */
export function color(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  return m ? token(m[1]) : c;
}

/* Canvas font at `px` CSS pixels, scaled for the device. */
export function font(px: number, scale = 1): string {
  return `${px * scale}px ${token('--font')}`;
}

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
