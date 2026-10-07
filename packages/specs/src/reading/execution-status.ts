import type { Run } from '../execution/execution.ts';

export type ExecutionStatus = Run['status'];

export const storedTypesByStatus: Readonly<Record<ExecutionStatus, readonly string[]>> = {
  started: [
    'execution_started',
    'execution_deferred',
    'execution_cancel_requested',
    'tool_call_started',
    'tool_call_answered',
  ],
  succeeded: ['execution_succeeded'],
  rejected: ['execution_rejected'],
  failed: ['execution_failed'],
};
