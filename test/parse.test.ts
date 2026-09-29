import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStream, parseText } from '../src/parse/parser';
import type { RawSample } from '../src/parse/types';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseText', () => {
  it('parses complete samples', () => {
    const { samples, diagnostics } = parseText(fixture('start.json'));
    expect(samples).toHaveLength(3);
    expect(diagnostics).toEqual({ lines: 34, malformed: 0, unknownTypes: {}, incomplete: 0 });

    const s = samples[0];
    expect(s.info).toEqual({ count: 2262, cpuLoad: [0.019684, 0.020326, 0.022344] });
    expect(s.clock).toMatchObject({
      id: 71,
      name: 'api.alsa.p-0',
      nsec: 276485751620,
      rate: { num: 1, denom: 48000 },
      duration: 480,
      delay: 1056,
      transport: 'stopped',
      cycle: 15098,
      xrun: 0,
    });
    expect(s.driver).toMatchObject({
      id: 71,
      name: 'alsa_output.platform-sound.HiFi__Speaker__sink',
      prev: 276475772113,
      signal: 276485769936,
      awake: 276485977261,
      finish: 276485983875,
      status: 'finished',
      latency: { num: 0, denom: 0 },
      xrunCount: 0,
    });
    expect(s.driver.pending).toBeUndefined();
    expect(s.followers.map((f) => f.id)).toEqual([46, 45, 124, 123, 199, 197, 195, 141]);
    expect(s.followers[7].latency).toEqual({ num: 512, denom: 48000 });
  });

  it('keeps samples with varying followers', () => {
    const { samples } = parseText(fixture('churn.json'));
    expect(samples.map((s) => s.followers.length)).toEqual([8, 7, 7]);
    expect(samples[0].followers[7]).toMatchObject({ name: 'Chromium', status: 'inactive' });
  });

  it('drops a truncated trailing sample', () => {
    const { samples, diagnostics } = parseText(fixture('truncated.json'));
    expect(samples).toHaveLength(2);
    expect(diagnostics.malformed).toBe(1);
    expect(diagnostics.incomplete).toBe(1);
  });

  it('counts unknown record types', () => {
    const { diagnostics } = parseText('[{ "type": "bogus" },\n{ } ]\n');
    expect(diagnostics.unknownTypes).toEqual({ bogus: 1 });
  });
});

describe('parseStream', () => {
  it('matches parseText across arbitrary chunk boundaries', async () => {
    const bytes = new TextEncoder().encode(fixture('start.json'));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 97) c.enqueue(bytes.subarray(i, i + 97));
        c.close();
      },
    });
    const samples: RawSample[] = [];
    let n = 0;
    await parseStream(stream, (s) => samples.push(s), (b) => (n += b));
    expect(n).toBe(bytes.length);
    expect(samples).toEqual(parseText(fixture('start.json')).samples);
  });
});
