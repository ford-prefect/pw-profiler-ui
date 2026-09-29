import type { ParseDiagnostics, RawBlock, RawSample } from '../parse/types';
import {
  BLOCK_FIELDS,
  CYCLE_FIELDS,
  FOLLOWER_CLOCK_FIELDS,
  type Columns,
  type Csr,
  type DriverData,
  type NodeData,
  type ProfileData,
} from './schema';

class ColumnSet<F extends string> {
  length = 0;
  private cap = 1024;
  private cols: Record<string, Float64Array> = {};
  private fields: readonly F[];

  constructor(fields: readonly F[]) {
    this.fields = fields;
    for (const f of fields) this.cols[f] = new Float64Array(this.cap);
  }

  /* Appends a row; fields missing from `row` are NaN. */
  push(row: Partial<Record<F, number | undefined>>): void {
    if (this.length === this.cap) {
      this.cap *= 2;
      for (const f of this.fields) {
        const a = new Float64Array(this.cap);
        a.set(this.cols[f]);
        this.cols[f] = a;
      }
    }
    for (const f of this.fields) this.cols[f][this.length] = row[f] ?? NaN;
    this.length++;
  }

  finish(): Columns<F> {
    const out = {} as Columns<F>;
    for (const f of this.fields) out[f] = this.cols[f].slice(0, this.length);
    return out;
  }
}

class DriverBuilder {
  cycleCount = 0;
  cycles = new ColumnSet(CYCLE_FIELDS);
  followers = new ColumnSet([...BLOCK_FIELDS, 'node' as const]);
  followerStart: number[] = [0];
  followerClocks = new ColumnSet(FOLLOWER_CLOCK_FIELDS);
  followerClockStart: number[] = [0];
  node: number;

  constructor(node: number) {
    this.node = node;
  }

  finish(): DriverData {
    const csr = <F extends string>(set: ColumnSet<F>, start: number[]): Csr<F> => ({
      start: Uint32Array.from(start),
      columns: set.finish(),
    });
    return {
      node: this.node,
      cycleCount: this.cycleCount,
      cycles: this.cycles.finish(),
      followers: csr(this.followers, this.followerStart),
      followerClocks: csr(this.followerClocks, this.followerClockStart),
    };
  }
}

export class ProfileBuilder {
  private strings: string[] = [];
  private stringIndex = new Map<string, number>();
  private nodes: NodeData[] = [];
  private nodeIndex = new Map<string, number>();
  private drivers: DriverBuilder[] = [];
  private driverIndex = new Map<number, DriverBuilder>();

  private str(s: string): number {
    let i = this.stringIndex.get(s);
    if (i === undefined) {
      i = this.strings.push(s) - 1;
      this.stringIndex.set(s, i);
    }
    return i;
  }

  /* Nodes are identified by (id, name) since ids are reused. */
  private node(id: number, name: string): number {
    const key = `${id}\0${name}`;
    let i = this.nodeIndex.get(key);
    if (i === undefined) {
      i = this.nodes.push({ id, name }) - 1;
      this.nodeIndex.set(key, i);
    }
    return i;
  }

  private block(b: RawBlock) {
    return {
      prev: b.prev,
      signal: b.signal,
      awake: b.awake,
      finish: b.finish,
      status: this.str(b.status),
      latencyNum: b.latency.num,
      latencyDenom: b.latency.denom,
      xrunCount: b.xrunCount,
      async: b.async === undefined ? undefined : Number(b.async),
      pending: b.pending,
      required: b.required,
    };
  }

  add(s: RawSample): void {
    const node = this.node(s.driver.id, s.driver.name);
    let d = this.driverIndex.get(node);
    if (!d) {
      d = new DriverBuilder(node);
      this.drivers.push(d);
      this.driverIndex.set(node, d);
    }

    const c = s.clock;
    const b = this.block(s.driver);
    d.cycles.push({
      'info.count': s.info?.count,
      'info.cpuLoad0': s.info?.cpuLoad[0],
      'info.cpuLoad1': s.info?.cpuLoad[1],
      'info.cpuLoad2': s.info?.cpuLoad[2],
      'clock.flags': c.flags,
      'clock.id': c.id,
      'clock.name': this.str(c.name),
      'clock.nsec': c.nsec,
      'clock.rateNum': c.rate.num,
      'clock.rateDenom': c.rate.denom,
      'clock.position': c.position,
      'clock.duration': c.duration,
      'clock.delay': c.delay,
      'clock.diff': c.diff,
      'clock.nextNsec': c.nextNsec,
      'clock.transport': this.str(c.transport),
      'clock.cycle': c.cycle,
      'clock.xrun': c.xrun,
      'driver.prev': b.prev,
      'driver.signal': b.signal,
      'driver.awake': b.awake,
      'driver.finish': b.finish,
      'driver.status': b.status,
      'driver.latencyNum': b.latencyNum,
      'driver.latencyDenom': b.latencyDenom,
      'driver.xrunCount': b.xrunCount,
      'driver.pending': b.pending,
      'driver.required': b.required,
    });

    for (const f of s.followers) {
      d.followers.push({ ...this.block(f), node: this.node(f.id, f.name) });
    }
    d.followerStart.push(d.followers.length);

    for (const fc of s.followerClocks) {
      d.followerClocks.push({
        id: fc.id,
        name: this.str(fc.name),
        nsec: fc.nsec,
        rateNum: fc.rate.num,
        rateDenom: fc.rate.denom,
        position: fc.position,
        duration: fc.duration,
        delay: fc.delay,
        diff: fc.diff,
        nextNsec: fc.nextNsec,
        xrun: fc.xrun,
      });
    }
    d.followerClockStart.push(d.followerClocks.length);

    d.cycleCount++;
  }

  finish(diagnostics: ParseDiagnostics): ProfileData {
    return {
      strings: this.strings,
      nodes: this.nodes,
      drivers: this.drivers.map((d) => d.finish()),
      diagnostics,
    };
  }
}
