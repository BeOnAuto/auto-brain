import type { AppRuntime } from '@beonauto/api';
import type { Dispatcher, DispatcherServices } from '@beonauto/operations';
import type { BrainOperation, Primitive } from '@beonauto/specs';
import {
  openWorkflowHost,
  type DatabaseSettings,
  type HostClock,
  type HostOptions,
  type ProjectorSettings,
  type WorkflowHost,
  type WorkflowStore,
} from '@beonauto/workflow-host';
import { Redacted } from 'effect';

import { logWorkflows } from '../logging/logging.ts';
import type { LedgerSettings } from '../settings/ledger-settings.ts';
import type { WorkflowSettings } from '../settings/workflow-settings.ts';
import { hostReports } from './host-reports.ts';
import { hostWorkOf } from './host-work.ts';

export interface HostParts {
  readonly ledger: LedgerSettings;
  readonly workflows: WorkflowSettings;
  readonly primitives: readonly Primitive[];
  readonly store: WorkflowStore;
  readonly views: ProjectorSettings;
  readonly dueWork: NonNullable<HostOptions['dueWork']>;
  readonly clock?: HostClock;
}

export function hostDatabaseOf(ledger: LedgerSettings): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file }
    : { store: 'postgresql', connectionString: Redacted.value(ledger.url) };
}

export async function openedHost(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { workflows, primitives, store, views, dueWork, clock }: HostParts,
  startVersion: BrainOperation,
): Promise<WorkflowHost> {
  const host = await openWorkflowHost({
    database: store,
    views,
    dueWork,
    ...hostWorkOf(runtime, dispatcher, { primitives, startVersion }),
    reports: hostReports(runtime),
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
    mostOpenCalls: workflows.mostOpenCalls,
    ...(clock === undefined ? {} : { clock }),
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
