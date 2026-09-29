import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProfile, Profile, type Block } from '../src/model';
import { parseText } from '../src/parse/parser';
import type { RawBlock, RawSample } from '../src/parse/types';

const load = (name: string) => {
  const { samples, diagnostics } = parseText(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  );
  return { samples, profile: buildProfile(samples, diagnostics) };
};

const block = (b: Block) => {
  const { node, ...rest } = b;
  return { id: node.id, name: node.name, ...rest };
};

/* The model must hand back exactly what was parsed. */
function expectRoundTrip(profile: Profile, samples: RawSample[]) {
  const d = profile.drivers[0];
  samples.forEach((s, i) => {
    const c = d.cycle(i);
    const strip = (b: RawBlock) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    expect(c.info).toEqual(s.info);
    expect(c.clock).toEqual(
      Object.fromEntries(Object.entries(s.clock).filter(([, v]) => v !== undefined)),
    );
    expect(strip(block(c.driver) as RawBlock)).toEqual(strip(s.driver));
    expect(c.followers.map((f) => strip(block(f) as RawBlock))).toEqual(s.followers.map(strip));
    expect(c.followerClocks).toEqual(s.followerClocks);
  });
}

describe('Profile', () => {
  it('groups samples by driver and interns nodes', () => {
    const { profile } = load('start.json');
    expect(profile.drivers).toHaveLength(1);
    const d = profile.drivers[0];
    expect(d.node).toMatchObject({ id: 71, name: 'alsa_output.platform-sound.HiFi__Speaker__sink' });
    expect(d.cycle(0).clock.name).toBe('api.alsa.p-0');
    expect(d.cycleCount).toBe(3);
    expect(d.followers.map((n) => n.id)).toEqual([46, 45, 124, 123, 199, 197, 195, 141]);
    expect(profile.nodes).toHaveLength(9);
    expect(profile.start).toBe(276485751620);
    expect([...d.series('clock.duration')]).toEqual([480, 480, 480]);
  });

  it('round-trips parsed samples', () => {
    for (const f of ['start.json', 'churn.json']) {
      const { profile, samples } = load(f);
      expectRoundTrip(profile, samples);
    }
  });

  it('marks absent nodes as NaN in dense series', () => {
    const { profile } = load('churn.json');
    const d = profile.drivers[0];
    const chromium = d.followers.find((n) => n.name === 'Chromium')!;
    const finish = d.nodeSeries(chromium, 'finish');
    expect(finish[0]).toBe(278675739975);
    expect(Number.isNaN(finish[1]) && Number.isNaN(finish[2])).toBe(true);
    expect(d.cycle(0).followers.at(-1)!.status).toBe('inactive');
  });

  it('survives transfer', () => {
    const { profile, samples } = load('start.json');
    const [data, transfer] = profile.toTransferable();
    const copy = new Profile(structuredClone(data, { transfer }));
    expectRoundTrip(copy, samples);
  });

  it('rejects out of range cycles', () => {
    const { profile } = load('start.json');
    expect(() => profile.drivers[0].cycle(3)).toThrow(RangeError);
  });
});
