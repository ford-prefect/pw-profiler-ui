import type { ParseDiagnostics, RawSample } from '../parse/types';
import { ProfileBuilder } from './builder';
import { Profile } from './profile';

export * from './profile';
export { ProfileBuilder } from './builder';
export type { ProfileData } from './schema';

export function buildProfile(samples: Iterable<RawSample>, diagnostics: ParseDiagnostics): Profile {
  const b = new ProfileBuilder();
  for (const s of samples) b.add(s);
  return new Profile(b.finish(diagnostics));
}
