import { proxyActivities } from '@temporalio/workflow';

import type { SpecCall, SpecCallResult } from './src/interpreter/host.ts';
import type { OrchestrationActivities } from './src/workflow/activity-contract.ts';

export { runWorkflowSpec } from './src/workflow/workflows.ts';

export function temporalGlobalProbe(): Promise<string> {
  return Promise.resolve(typeof Reflect.get(globalThis, 'Temporal'));
}

function activitiesOn(taskQueue: string): OrchestrationActivities {
  return proxyActivities<OrchestrationActivities>({
    taskQueue,
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 1 },
  });
}

export function executeSpecOn(taskQueue: string, call: SpecCall): Promise<SpecCallResult> {
  return activitiesOn(taskQueue).executeSpec(call);
}

export async function executeSpecTwiceOn(taskQueue: string, call: SpecCall): Promise<readonly SpecCallResult[]> {
  const activities = activitiesOn(taskQueue);
  const first = await activities.executeSpec(call);
  return [first, await activities.executeSpec(call)];
}
