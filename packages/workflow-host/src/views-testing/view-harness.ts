import { appendSignal, type AppendSignal } from '@beonauto/ledger';
import { programPool, type PoolSettings, type ProgramPool } from '@beonauto/workflow-engine/dsl';
import { onTestFinished } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { openWorkflowStore, type WorkflowStore } from '../host/workflow-store.ts';
import { recordingReports, type RecordingReports } from '../testing/recording-reports.ts';
import { brainAppends, type BrainAppends } from './brain-appends.ts';
import { harnessProjectors, type HarnessProjectors } from './harness-projectors.ts';
import { measuredEnvironment, settingsOver, type ViewSettingsOf } from './view-documents.ts';
import { viewReadingOf, type ViewReading } from './view-reading.ts';

export interface ViewHarness extends BrainAppends, ViewReading, HarnessProjectors {
  readonly store: WorkflowStore;
  readonly reports: RecordingReports;
  readonly pool: ProgramPool;
  readonly appends: AppendSignal;
  readonly settingsOf: ViewSettingsOf;
}

export async function viewHarness(
  settings: DatabaseSettings,
  poolSettings: Partial<PoolSettings> = {},
): Promise<ViewHarness> {
  const reports = recordingReports();
  const store = await openWorkflowStore(settings, reports.reports.lostConnection);
  const pool = programPool({ workers: 4, heapMegabytes: 64, environment: measuredEnvironment, ...poolSettings });
  const appends = appendSignal();
  const settingsOf = settingsOver(pool, appends);
  const projectors = harnessProjectors({ database: store.database, reports: reports.reports, settingsOf });
  onTestFinished(async () => {
    await projectors.stopProjectors();
    await pool.close();
    await store.database.close();
  });
  return {
    ...brainAppends(store.database.store, appends),
    ...viewReadingOf(store.views),
    ...projectors,
    store,
    reports,
    pool,
    appends,
    settingsOf,
  };
}
