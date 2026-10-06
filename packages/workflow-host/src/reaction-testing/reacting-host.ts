import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import type { DatabaseSettings } from '../database/host-databases.ts';
import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { recordingReports, recordingSettlements, type RecordingReports } from '../testing/recording-reports.ts';
import { recordedReactions, type FailingStart, type RecordedReactions } from './recorded-reactions.ts';

const startsEveryTime: FailingStart = () => null;

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
  readonly failure?: FailingStart;
  readonly start?: RecordedReactions['options']['start'];
  readonly appended?: RecordedReactions['options']['appended'];
  readonly consumers?: HostOptions['consumers'];
}

export async function reactingHost(options: ReactingOptions = {}): Promise<ReactingHost> {
  const settings = options.settings ?? { store: 'sqlite', file: aSQLiteFile() };
  const reports = recordingReports();
  const reactions = recordedReactions({ failure: options.failure ?? startsEveryTime });
  const host = await openWorkflowHost({
    database: settings,
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle: recordingSettlements(() => false).settle,
    reports: reports.reports,
    sweepEveryMs: options.sweepEveryMs ?? 20,
    mostCallsAtOnce: 4,
    reactions: {
      ...reactions.options,
      start: options.start ?? reactions.options.start,
      ...(options.appended === undefined ? {} : { appended: options.appended }),
    },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.consumers === undefined ? {} : { consumers: options.consumers }),
  });
  onTestFinished(() => host.stop());
  const database = await openedOn(settings);
  return { host, database, reactions, notes: reports.notes, settings };
}
