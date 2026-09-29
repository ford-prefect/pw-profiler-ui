/* Parses a capture and builds the model off the main thread. */
import { ProfileBuilder } from './model/builder';
import { Profile } from './model/profile';
import type { ProfileData } from './model/schema';
import { parseStream } from './parse/parser';

export type WorkerMessage =
  | { type: 'progress'; bytes: number }
  | { type: 'done'; data: ProfileData }
  | { type: 'error'; message: string };

const post = (m: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(m, { transfer });

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const builder = new ProfileBuilder();
    let bytes = 0;
    let last = 0;
    const diagnostics = await parseStream(
      e.data.stream(),
      (s) => builder.add(s),
      (n) => {
        bytes += n;
        if (bytes - last > 1 << 22) {
          post({ type: 'progress', bytes });
          last = bytes;
        }
      },
    );
    const [data, transfer] = new Profile(builder.finish(diagnostics)).toTransferable();
    post({ type: 'done', data }, transfer);
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
