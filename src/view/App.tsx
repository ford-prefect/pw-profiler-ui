import { Clients } from './Clients';
import { CycleView } from './CycleView';
import { Distribution } from './Distribution';
import { Drivers } from './Drivers';
import { count } from './format';
import { Loader } from './Loader';
import { Outliers } from './Outliers';
import { driverIndex, fileName, profile, selectDriver, selectedCycle, zoom } from './state';
import { Summary } from './Summary';
import { Timeline } from './Timeline';
import './style.css';

function Header() {
  const p = profile.value;
  return (
    <header>
      <h1>pw-profiler</h1>
      {p && (
        <>
          <span class="file">{fileName.value}</span>
          {p.drivers.length > 1 && (
            <select
              value={driverIndex.value}
              onChange={(e) => selectDriver(Number((e.target as HTMLSelectElement).value))}
            >
              {p.drivers
                .map((d, i) => [d, i] as const)
                .sort(([a], [b]) => b.cycleCount - a.cycleCount)
                .map(([d, i]) => (
                  <option key={i} value={i}>
                    {d.node.name} ({d.node.id}) · {count(d.cycleCount)} cycles
                  </option>
                ))}
            </select>
          )}
          {zoom.value && (
            <button class="button" onClick={() => (zoom.value = null)}>
              Reset zoom
            </button>
          )}
          <span class="spacer" />
          <Loader compact />
        </>
      )}
    </header>
  );
}

export function App() {
  return (
    <>
      <Header />
      <main>
        {profile.value ? (
          <>
            {profile.value.drivers.length > 1 && <Drivers />}
            <Summary />
            <Timeline />
            {selectedCycle.value != null && <CycleView />}
            <Outliers />
            <Distribution />
            <Clients />
          </>
        ) : (
          <Loader />
        )}
      </main>
    </>
  );
}
