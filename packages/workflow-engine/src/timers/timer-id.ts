import { Schema } from 'effect';

export const TimerPurposeSchema = Schema.Literals([
  'wait',
  'timeout',
  'retry_delay',
  'attempt_limit',
  'deadline',
  'call_deadline',
  'yield',
]);

export type TimerPurpose = typeof TimerPurposeSchema.Type;

export function timerIdOf(executionId: string, sequence: number): string {
  return `${executionId}/timers/${sequence}`;
}
