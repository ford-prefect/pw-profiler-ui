import { useSignal } from '@preact/signals';
import { bytes } from './format';
import { loadProfile } from './load';
import { error, loading, setProfile } from './state';

async function open(file: File) {
  error.value = null;
  loading.value = { bytes: 0, total: file.size };
  try {
    const p = await loadProfile(file, (n) => (loading.value = { bytes: n, total: file.size }));
    if (!p.drivers.length) throw new Error('No profiler samples found');
    setProfile(p, file.name);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = null;
  }
}

export function Loader({ compact = false }: { compact?: boolean }) {
  const over = useSignal(false);
  const pick = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) open(f);
  };
  const l = loading.value;

  if (compact) {
    return (
      <label class="button">
        Open…
        <input type="file" accept=".json,application/json" onChange={pick} hidden />
      </label>
    );
  }

  return (
    <div
      class={`drop ${over.value ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        over.value = true;
      }}
      onDragLeave={() => (over.value = false)}
      onDrop={(e) => {
        e.preventDefault();
        over.value = false;
        const f = e.dataTransfer?.files[0];
        if (f) open(f);
      }}
    >
      {l ? (
        <>
          <p>Loading… {bytes(l.bytes)} of {bytes(l.total)}</p>
          <progress value={l.bytes} max={l.total} />
        </>
      ) : (
        <>
          <p>
            Drop a capture from <code>pw-profiler -J &gt; profile.json</code> here, or
          </p>
          <label class="button primary">
            Choose file
            <input type="file" accept=".json,application/json" onChange={pick} hidden />
          </label>
          <p class="muted">The file is processed locally and never uploaded.</p>
        </>
      )}
      {error.value && <p class="error">{error.value}</p>}
    </div>
  );
}
