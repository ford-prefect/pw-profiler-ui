/* Records as emitted by `pw-profiler -J`. Optional fields are absent in older versions. */

export interface Fraction {
  num: number;
  denom: number;
}

export interface RawInfo {
  count: number;
  cpuLoad: [number, number, number];
}

export interface RawClock {
  flags: number;
  id: number;
  name: string;
  nsec: number;
  rate: Fraction;
  position: number;
  duration: number;
  delay: number;
  diff: number;
  nextNsec: number;
  transport: string;
  cycle?: number;
  xrun?: number;
}

export interface RawBlock {
  id: number;
  name: string;
  prev: number;
  signal: number;
  awake: number;
  finish: number;
  status: string;
  latency: Fraction;
  xrunCount: number;
  async?: boolean;
  pending?: number;
  required?: number;
}

export interface RawFollowerClock {
  id: number;
  name: string;
  nsec: number;
  rate: Fraction;
  position: number;
  duration: number;
  delay: number;
  diff: number;
  nextNsec: number;
  xrun: number;
}

/* One profiler sample: a single driver cycle. */
export interface RawSample {
  info?: RawInfo;
  clock: RawClock;
  driver: RawBlock;
  followers: RawBlock[];
  followerClocks: RawFollowerClock[];
}

export interface ParseDiagnostics {
  lines: number;
  malformed: number;
  unknownTypes: Record<string, number>;
  /* Samples dropped for lacking a clock or driver record. */
  incomplete: number;
}
