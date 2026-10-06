import type { Run } from '../execution/execution.ts';

export type ExecutionStatus = Run['status'];

export const storedTypesByStatus: Readonly<Record<ExecutionStatus, readonly string[]>> = {
  started: ['execution_started', 'execution_deferred'],
  succeeded: ['execution_succeeded'],
  rejected: ['execution_rejected'],
  failed: ['execution_failed'],
};
