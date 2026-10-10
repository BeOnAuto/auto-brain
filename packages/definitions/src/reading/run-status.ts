import type { Run } from '../runs/run.ts';

export type RunStatus = Run['status'];

export const storedTypesByStatus: Readonly<Record<RunStatus, readonly string[]>> = {
  started: [
    'run_started',
    'run_deferred',
    'run_cancel_requested',
    'tool_call_started',
    'tool_call_answered',
    'tool_call_failed',
    'delivery_started',
    'delivery_succeeded',
    'delivery_failed',
    'delivery_refused',
    'reply_taken',
    'reply_refused',
  ],
  succeeded: ['run_succeeded'],
  rejected: ['run_rejected'],
  failed: ['run_failed'],
};
