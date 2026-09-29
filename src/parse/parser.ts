import type {
  Fraction,
  ParseDiagnostics,
  RawBlock,
  RawClock,
  RawFollowerClock,
  RawInfo,
  RawSample,
} from './types';

class FieldError extends Error {}

type Obj = Record<string, unknown>;

function num(o: Obj, k: string): number {
  const v = o[k];
  if (typeof v !== 'number') throw new FieldError(k);
  return v;
}

function optNum(o: Obj, k: string): number | undefined {
  return k in o ? num(o, k) : undefined;
}

function str(o: Obj, k: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new FieldError(k);
  return v;
}

function frac(o: Obj, k: string): Fraction {
  const m = /^(\d+)\/(\d+)$/.exec(str(o, k));
  if (!m) throw new FieldError(k);
  return { num: Number(m[1]), denom: Number(m[2]) };
}

function info(o: Obj): RawInfo {
  return {
    count: num(o, 'count'),
    cpuLoad: [num(o, 'cpu_load0'), num(o, 'cpu_load1'), num(o, 'cpu_load2')],
  };
}

function clock(o: Obj): RawClock {
  return {
    flags: num(o, 'flags'),
    id: num(o, 'id'),
    name: str(o, 'name'),
    nsec: num(o, 'nsec'),
    rate: frac(o, 'rate'),
    position: num(o, 'position'),
    duration: num(o, 'duration'),
    delay: num(o, 'delay'),
    diff: num(o, 'diff'),
    nextNsec: num(o, 'next_nsec'),
    transport: str(o, 'transport'),
    cycle: optNum(o, 'cycle'),
    xrun: optNum(o, 'xrun'),
  };
}

function block(o: Obj): RawBlock {
  const b: RawBlock = {
    id: num(o, 'id'),
    name: str(o, 'name'),
    prev: num(o, 'prev'),
    signal: num(o, 'signal'),
    awake: num(o, 'awake'),
    finish: num(o, 'finish'),
    status: str(o, 'status'),
    latency: frac(o, 'latency'),
    xrunCount: num(o, 'xrun_count'),
    pending: optNum(o, 'pending'),
    required: optNum(o, 'required'),
  };
  if (typeof o.async === 'boolean') b.async = o.async;
  return b;
}

function followerClock(o: Obj): RawFollowerClock {
  return {
    id: num(o, 'id'),
    name: str(o, 'name'),
    nsec: num(o, 'nsec'),
    rate: frac(o, 'rate'),
    position: num(o, 'position'),
    duration: num(o, 'duration'),
    delay: num(o, 'delay'),
    diff: num(o, 'diff'),
    nextNsec: num(o, 'next_nsec'),
    xrun: num(o, 'xrun'),
  };
}

interface Pending {
  info?: RawInfo;
  clock?: RawClock;
  driver?: RawBlock;
  followers: RawBlock[];
  followerClocks: RawFollowerClock[];
}

function emptyPending(): Pending {
  return { followers: [], followerClocks: [] };
}

/*
 * Incremental parser. pw-profiler writes one record per line inside a JSON
 * array, so lines are parsed individually: a truncated capture loses only its
 * last partial sample.
 */
export class SampleParser {
  readonly diagnostics: ParseDiagnostics = {
    lines: 0,
    malformed: 0,
    unknownTypes: {},
    incomplete: 0,
  };
  private rest = '';
  private cur = emptyPending();
  private onSample: (s: RawSample) => void;

  constructor(onSample: (s: RawSample) => void) {
    this.onSample = onSample;
  }

  push(chunk: string): void {
    const text = this.rest + chunk;
    let start = 0;
    let nl: number;
    while ((nl = text.indexOf('\n', start)) >= 0) {
      this.line(text.slice(start, nl));
      start = nl + 1;
    }
    this.rest = text.slice(start);
  }

  end(): ParseDiagnostics {
    if (this.rest) this.line(this.rest);
    this.rest = '';
    this.flush();
    return this.diagnostics;
  }

  private line(raw: string): void {
    let s = raw.trim();
    if (s.startsWith('[')) s = s.slice(1).trimStart();
    if (s.endsWith(']')) s = s.slice(0, -1).trimEnd();
    if (s.endsWith(',')) s = s.slice(0, -1);
    if (!s) return;
    this.diagnostics.lines++;

    let o: unknown;
    try {
      o = JSON.parse(s);
    } catch {
      this.diagnostics.malformed++;
      return;
    }
    if (typeof o !== 'object' || o === null || Array.isArray(o)) {
      this.diagnostics.malformed++;
      return;
    }
    const rec = o as Obj;
    /* The array is terminated by an empty object. */
    if (!('type' in rec) && Object.keys(rec).length === 0) return;

    try {
      this.record(rec);
    } catch (e) {
      if (!(e instanceof FieldError)) throw e;
      this.diagnostics.malformed++;
    }
  }

  private record(o: Obj): void {
    const type = o.type;
    const c = this.cur;
    switch (type) {
      case 'info':
        this.flush();
        this.cur.info = info(o);
        break;
      case 'clock':
        if (c.clock) this.flush();
        this.cur.clock = clock(o);
        break;
      case 'driver':
        if (c.driver) this.flush();
        this.cur.driver = block(o);
        break;
      case 'follower':
        c.followers.push(block(o));
        break;
      case 'followerClock':
        c.followerClocks.push(followerClock(o));
        break;
      default: {
        const k = String(type);
        this.diagnostics.unknownTypes[k] = (this.diagnostics.unknownTypes[k] ?? 0) + 1;
      }
    }
  }

  private flush(): void {
    const c = this.cur;
    this.cur = emptyPending();
    if (c.clock && c.driver) {
      this.onSample({
        info: c.info,
        clock: c.clock,
        driver: c.driver,
        followers: c.followers,
        followerClocks: c.followerClocks,
      });
    } else if (c.info || c.clock || c.driver || c.followers.length || c.followerClocks.length) {
      this.diagnostics.incomplete++;
    }
  }
}

export function parseText(text: string): { samples: RawSample[]; diagnostics: ParseDiagnostics } {
  const samples: RawSample[] = [];
  const p = new SampleParser((s) => samples.push(s));
  p.push(text);
  return { samples, diagnostics: p.end() };
}

export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  onSample: (s: RawSample) => void,
  onBytes?: (n: number) => void,
): Promise<ParseDiagnostics> {
  const p = new SampleParser(onSample);
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    p.push(decoder.decode(value, { stream: true }));
    onBytes?.(value.byteLength);
  }
  p.push(decoder.decode());
  return p.end();
}
