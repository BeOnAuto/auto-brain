import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import { systemClock } from '../loop/host-clock.ts';
import type { ProjectorSettings } from '../projector/projector-settings.ts';
import { startProjector, type Projector } from '../projector/projector.ts';
import { countingDatabase } from './counting-database.ts';

type StartOf = Partial<ProjectorSettings> & { readonly sweepEveryMs?: number };

export interface HarnessProjectors {
  readonly start: (more?: StartOf) => Projector;
  readonly reads: () => number;
  readonly failingDiscovery: (fails: boolean) => void;
  readonly stopProjectors: () => Promise<unknown>;
}

export interface ProjectorsOf {
  readonly database: HostDatabase;
  readonly reports: HostReports;
  readonly settingsOf: (more?: Partial<ProjectorSettings>) => ProjectorSettings;
}

export function harnessProjectors({ database, reports, settingsOf }: ProjectorsOf): HarnessProjectors {
  const counting = countingDatabase(database);
  const projectors: Projector[] = [];
  return {
    reads: counting.reads,
    failingDiscovery: counting.failingDiscovery,
    start: ({ sweepEveryMs = 50, ...more } = {}) => {
      const projector = startProjector({
        database: counting.database,
        settings: settingsOf(more),
        reports,
        clock: systemClock,
        sweepEveryMs,
      });
      projectors.push(projector);
      return projector;
    },
    stopProjectors: () => Promise.all(projectors.map((projector) => projector.stop())),
  };
}
