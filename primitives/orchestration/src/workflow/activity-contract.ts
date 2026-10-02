import type { SettleRequest, SpecCall, SpecCallResult } from '../interpreter/host.ts';

export interface OrchestrationActivities {
  readonly executeSpec: (call: SpecCall) => Promise<SpecCallResult>;
  readonly settleExecution: (request: SettleRequest) => Promise<void>;
}

export const workflowType = 'runWorkflowSpec';

export const eventSignalName = 'event';

export const tenancyViolation = 'TenancyViolation';

export const executionNotFound = 'ExecutionNotFound';

export const executionConflict = 'ExecutionConflict';

export const mostSettleAttempts = 20;

export function workflowIdOf(org: string, brain: string, spec: string, executionId: string): string {
  return `${org}/${brain}/${spec}/${executionId}`;
}
