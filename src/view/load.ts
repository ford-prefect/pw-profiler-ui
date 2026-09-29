import { Profile } from '../model';
import type { WorkerMessage } from '../worker';

export function loadProfile(file: File, onProgress: (bytes: number) => void): Promise<Profile> {
  const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Profile>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress(m.bytes);
      worker.terminate();
      if (m.type === 'done') resolve(new Profile(m.data));
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(file);
  });
}
