import type { AppRuntime } from '@beonauto/api';
import type { Dispatcher, DispatcherServices } from '@beonauto/operations';
import type { BrainOperation, Primitive } from '@beonauto/specs';
import { openWorkflowHost, type DatabaseSettings, type WorkflowHost } from '@beonauto/workflow-host';
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
}

export function hostDatabaseOf(ledger: LedgerSettings): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file }
    : { store: 'postgresql', connectionString: Redacted.value(ledger.url) };
}

export async function openedHost(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { ledger, workflows, primitives }: HostParts,
  startVersion: BrainOperation,
): Promise<WorkflowHost> {
  const host = await openWorkflowHost({
    database: hostDatabaseOf(ledger),
    ...hostWorkOf(runtime, dispatcher, { primitives, startVersion }),
    reports: hostReports(runtime),
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
