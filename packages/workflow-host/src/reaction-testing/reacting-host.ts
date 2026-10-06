import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import type { DatabaseSettings } from '../database/host-databases.ts';
import { openWorkflowHost, type WorkflowHost } from '../host/workflow-host.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import {
  recordedReactions,
  recordingReports,
  recordingSettlements,
  type RecordedReactions,
  type RecordingReports,
} from '../testing/recording-reports.ts';

export interface ReactingHost {
  readonly host: WorkflowHost;
  readonly database: HostDatabase;
  readonly reactions: RecordedReactions;
  readonly notes: RecordingReports['notes'];
  readonly settings: DatabaseSettings;
}

export interface ReactingOptions {
  readonly settings?: DatabaseSettings;
  readonly clock?: HostClock;
  readonly sweepEveryMs?: number;
  readonly refusesStarts?: () => boolean;
}

export async function reactingHost(options: ReactingOptions = {}): Promise<ReactingHost> {
  const settings = options.settings ?? { store: 'sqlite', file: aSQLiteFile() };
  const reports = recordingReports();
  const reactions = recordedReactions({ refusesStarts: options.refusesStarts ?? (() => false) });
  const host = await openWorkflowHost({
    database: settings,
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle: recordingSettlements(() => false).settle,
    reports: reports.reports,
    sweepEveryMs: options.sweepEveryMs ?? 20,
    mostCallsAtOnce: 4,
    reactions: reactions.options,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  onTestFinished(() => host.stop());
  const database = await openedOn(settings);
  return { host, database, reactions, notes: reports.notes, settings };
}
