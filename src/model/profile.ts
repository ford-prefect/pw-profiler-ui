import type { ParseDiagnostics } from '../parse/types';
import type {
  BlockField,
  Csr,
  CycleField,
  DriverData,
  ProfileData,
} from './schema';

export type { BlockField, CycleField } from './schema';

/* Model arrays are shared; consumers must not write to them. */
export type Series = Readonly<Float64Array>;

export interface Node {
  index: number;
  id: number;
  name: string;
}

export interface Fraction {
  num: number;
  denom: number;
}

export interface Block {
  node: Node;
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

export interface Clock {
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

export interface FollowerClock {
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

export interface Cycle {
  index: number;
  info?: { count: number; cpuLoad: [number, number, number] };
  clock: Clock;
  driver: Block;
  followers: Block[];
  followerClocks: FollowerClock[];
}

const opt = (v: number) => (Number.isNaN(v) ? undefined : v);

export class Driver {
  readonly node: Node;
  readonly cycleCount: number;
  /* Followers seen under this driver, in order of first appearance. */
  readonly followers: readonly Node[];
  private data: DriverData;
  private nodes: readonly Node[];
  private strings: readonly string[];
  private dense = new Map<string, Float64Array>();

  constructor(nodes: readonly Node[], strings: readonly string[], data: DriverData) {
    this.nodes = nodes;
    this.strings = strings;
    this.data = data;
    this.node = nodes[data.node];
    this.cycleCount = data.cycleCount;

    const seen = new Set<number>();
    for (const n of data.followers.columns.node) seen.add(n);
    this.followers = [...seen].map((i) => nodes[i]);
  }

  /* Value that string-valued fields (status, transport, names) hold for `s`, or -1. */
  stringId(s: string): number {
    return this.strings.indexOf(s);
  }

  string(id: number): string | undefined {
    return this.strings[id];
  }

  series(field: CycleField): Series {
    return this.data.cycles[field];
  }

  /* Per-cycle values of a follower's field; NaN where the node is absent. */
  nodeSeries(node: Node, field: BlockField): Series {
    const key = `${node.index}:${field}`;
    let out = this.dense.get(key);
    if (!out) {
      const { start, columns } = this.data.followers;
      const src = columns[field];
      const nodes = columns.node;
      out = new Float64Array(this.cycleCount).fill(NaN);
      for (let c = 0; c < this.cycleCount; c++) {
        for (let j = start[c]; j < start[c + 1]; j++) {
          if (nodes[j] === node.index) {
            out[c] = src[j];
            break;
          }
        }
      }
      this.dense.set(key, out);
    }
    return out;
  }

  /* Clocks of followers that are drivers themselves, in cycle i. */
  followerClocks(i: number): FollowerClock[] {
    return rows(this.data.followerClocks, i, (col, j) => ({
      id: col.id[j],
      name: this.strings[col.name[j]],
      nsec: col.nsec[j],
      rate: { num: col.rateNum[j], denom: col.rateDenom[j] },
      position: col.position[j],
      duration: col.duration[j],
      delay: col.delay[j],
      diff: col.diff[j],
      nextNsec: col.nextNsec[j],
      xrun: col.xrun[j],
    }));
  }

  cycle(i: number): Cycle {
    if (!(i >= 0 && i < this.cycleCount)) throw new RangeError(`cycle ${i}`);
    const c = this.data.cycles;
    const s = (f: CycleField) => c[f][i];
    const str = (v: number) => this.strings[v];

    const followers = rows(this.data.followers, i, (col, j) => this.block(col, j));
    const followerClocks = this.followerClocks(i);

    return {
      index: i,
      info: Number.isNaN(s('info.count'))
        ? undefined
        : {
            count: s('info.count'),
            cpuLoad: [s('info.cpuLoad0'), s('info.cpuLoad1'), s('info.cpuLoad2')],
          },
      clock: {
        flags: s('clock.flags'),
        id: s('clock.id'),
        name: str(s('clock.name')),
        nsec: s('clock.nsec'),
        rate: { num: s('clock.rateNum'), denom: s('clock.rateDenom') },
        position: s('clock.position'),
        duration: s('clock.duration'),
        delay: s('clock.delay'),
        diff: s('clock.diff'),
        nextNsec: s('clock.nextNsec'),
        transport: str(s('clock.transport')),
        cycle: opt(s('clock.cycle')),
        xrun: opt(s('clock.xrun')),
      },
      driver: {
        node: this.node,
        prev: s('driver.prev'),
        signal: s('driver.signal'),
        awake: s('driver.awake'),
        finish: s('driver.finish'),
        status: str(s('driver.status')),
        latency: { num: s('driver.latencyNum'), denom: s('driver.latencyDenom') },
        xrunCount: s('driver.xrunCount'),
        pending: opt(s('driver.pending')),
        required: opt(s('driver.required')),
      },
      followers,
      followerClocks,
    };
  }

  private block(col: DriverData['followers']['columns'], j: number): Block {
    const async = col.async[j];
    return {
      node: this.nodes[col.node[j]],
      prev: col.prev[j],
      signal: col.signal[j],
      awake: col.awake[j],
      finish: col.finish[j],
      status: this.strings[col.status[j]],
      latency: { num: col.latencyNum[j], denom: col.latencyDenom[j] },
      xrunCount: col.xrunCount[j],
      async: Number.isNaN(async) ? undefined : async !== 0,
      pending: opt(col.pending[j]),
      required: opt(col.required[j]),
    };
  }
}

function rows<F extends string, T>(
  csr: Csr<F>,
  i: number,
  f: (col: Csr<F>['columns'], j: number) => T,
): T[] {
  const out: T[] = [];
  for (let j = csr.start[i]; j < csr.start[i + 1]; j++) out.push(f(csr.columns, j));
  return out;
}

export class Profile {
  readonly nodes: readonly Node[];
  readonly drivers: readonly Driver[];
  readonly diagnostics: ParseDiagnostics;
  /* Capture span in ns, from the earliest to the latest clock time. */
  readonly start: number;
  readonly end: number;
  private data: ProfileData;

  constructor(data: ProfileData) {
    this.data = data;
    this.diagnostics = data.diagnostics;
    this.nodes = data.nodes.map((n, index) => ({ index, ...n }));
    this.drivers = data.drivers.map((d) => new Driver(this.nodes, data.strings, d));

    let start = Infinity;
    let end = -Infinity;
    for (const d of data.drivers) {
      const t = d.cycles['clock.nsec'];
      if (!t.length) continue;
      start = Math.min(start, t[0]);
      end = Math.max(end, t[t.length - 1]);
    }
    this.start = start;
    this.end = end;
  }

  /* Plain data plus the buffers to transfer, for postMessage(). */
  toTransferable(): [ProfileData, ArrayBuffer[]] {
    const buffers: ArrayBuffer[] = [];
    const add = (cols: Record<string, Float64Array>) => {
      for (const a of Object.values(cols)) buffers.push(a.buffer as ArrayBuffer);
    };
    for (const d of this.data.drivers) {
      add(d.cycles);
      add(d.followers.columns);
      add(d.followerClocks.columns);
      buffers.push(d.followers.start.buffer as ArrayBuffer, d.followerClocks.start.buffer as ArrayBuffer);
    }
    return [this.data, buffers];
  }
}
