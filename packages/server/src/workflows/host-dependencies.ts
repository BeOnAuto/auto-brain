import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import type { Dispatcher, DispatcherServices } from '@on.auto/operations';
import {
  openWorkflowHost,
  type DatabaseSettings,
  type HostClock,
  type HostOptions,
  type ProjectorSettings,
  type WorkflowHost,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import { databasePoolsOf } from '../database/database-pools.ts';
import { logWorkflows } from '../logging/logging.ts';
import type { Settings } from '../settings/settings.ts';
import { hostReports } from './host-reports.ts';
import { hostWorkOf, type WorkParts } from './host-work.ts';

export interface HostParts {
  readonly ledger: Settings['ledger'];
  readonly workflows: Settings['workflows'];
  readonly capabilities: readonly Capability[];
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
  readonly dueWork: NonNullable<HostOptions['dueWork']>;
  readonly evaluations: WorkParts['evaluations'];
  readonly clock?: HostClock;
}

export function hostDatabaseOf({ ledger, proxy }: Pick<Settings, 'ledger' | 'proxy'>): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file }
    : { store: 'postgresql', pools: databasePoolsOf(ledger, proxy) };
}

export async function openedHost(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { workflows, capabilities, store, projector, dueWork, evaluations, clock }: HostParts,
  { startVersion, names }: Pick<WorkParts, 'startVersion' | 'names'>,
): Promise<WorkflowHost> {
  const host = await openWorkflowHost({
    database: store,
    projector,
    dueWork,
    ...hostWorkOf(runtime, dispatcher, { capabilities, startVersion, evaluations, names }),
    reports: hostReports(runtime),
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
    mostOpenCalls: workflows.mostOpenCalls,
    ...(clock === undefined ? {} : { clock }),
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
