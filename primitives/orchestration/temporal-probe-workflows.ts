import { proxyActivities } from '@temporalio/workflow';

import type { SpecCall, SpecCallResult } from './src/interpreter/host.ts';
import type { OrchestrationActivities } from './src/workflow/activity-contract.ts';

export { runWorkflowSpec } from './src/workflow/workflows.ts';

export function temporalGlobalProbe(): Promise<string> {
  return Promise.resolve(typeof Reflect.get(globalThis, 'Temporal'));
}

export function executeSpecOn(taskQueue: string, call: SpecCall): Promise<SpecCallResult> {
  return proxyActivities<OrchestrationActivities>({
    taskQueue,
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 1 },
  }).executeSpec(call);
}
