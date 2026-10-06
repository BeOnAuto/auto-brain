import type { Conflict } from '@beonauto/operations';
import type { RunInput, Submission } from '@beonauto/workflow-engine';
import type { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HostClock } from '../loop/host-clock.ts';

export interface FollowerHost {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly clock: HostClock;
  readonly sweepEveryMs: number;
  readonly reports: HostReports;
}
