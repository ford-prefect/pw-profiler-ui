import type { ParseDiagnostics } from '../parse/types';

/*
 * Column layout of the model. Every column is a Float64Array; NaN marks a
 * value absent from the input. String-valued fields are stored as indices
 * into the profile's string table.
 */

export const CYCLE_FIELDS = [
  'info.count',
  'info.cpuLoad0',
  'info.cpuLoad1',
  'info.cpuLoad2',
  'clock.flags',
  'clock.id',
  'clock.name',
  'clock.nsec',
  'clock.rateNum',
  'clock.rateDenom',
  'clock.position',
  'clock.duration',
  'clock.delay',
  'clock.diff',
  'clock.nextNsec',
  'clock.transport',
  'clock.cycle',
  'clock.xrun',
  'driver.prev',
  'driver.signal',
  'driver.awake',
  'driver.finish',
  'driver.status',
  'driver.latencyNum',
  'driver.latencyDenom',
  'driver.xrunCount',
  'driver.pending',
  'driver.required',
] as const;

export const BLOCK_FIELDS = [
  'prev',
  'signal',
  'awake',
  'finish',
  'status',
  'latencyNum',
  'latencyDenom',
  'xrunCount',
  'async',
  'pending',
  'required',
] as const;

export const FOLLOWER_CLOCK_FIELDS = [
  'id',
  'name',
  'nsec',
  'rateNum',
  'rateDenom',
  'position',
  'duration',
  'delay',
  'diff',
  'nextNsec',
  'xrun',
] as const;

export type CycleField = (typeof CYCLE_FIELDS)[number];
export type BlockField = (typeof BLOCK_FIELDS)[number];
export type FollowerClockField = (typeof FOLLOWER_CLOCK_FIELDS)[number];

export type Columns<F extends string> = Record<F, Float64Array>;

/* Compressed sparse rows: entries of cycle i are [start[i], start[i + 1]). */
export interface Csr<F extends string> {
  start: Uint32Array;
  columns: Columns<F>;
}

export interface NodeData {
  id: number;
  name: string;
}

export interface DriverData {
  node: number;
  cycleCount: number;
  cycles: Columns<CycleField>;
  followers: Csr<BlockField | 'node'>;
  followerClocks: Csr<FollowerClockField>;
}

/* Plain, structured-clone friendly form of a Profile. */
export interface ProfileData {
  strings: string[];
  nodes: NodeData[];
  drivers: DriverData[];
  diagnostics: ParseDiagnostics;
}
