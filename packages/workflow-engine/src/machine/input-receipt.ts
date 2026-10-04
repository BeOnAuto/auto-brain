import { Schema } from 'effect';

import { callKeyText } from '../executor/call-key.ts';
import type { RunInput } from './run-input.ts';
import type { RunState } from './run-state.ts';

export const InputReceiptSchema = Schema.Struct({
  kind: Schema.Literals(['started', 'timer_fired', 'call_answered', 'event_received', 'cancel_requested']),
  key: Schema.String,
  at: Schema.Int,
});

export type InputReceipt = typeof InputReceiptSchema.Type;

function keyOf(input: RunInput): string {
  if (input.kind === 'timer_fired') {
    return input.timerId;
  }
  if (input.kind === 'call_answered') {
    return callKeyText(input.key);
  }
  return input.kind === 'event_received' ? input.event.id : input.executionId;
}

export function receiptOf(input: RunInput): InputReceipt {
  return { kind: input.kind, key: keyOf(input), at: input.at };
}

function isSpent(state: RunState, input: RunInput): boolean {
  if (input.kind === 'started') {
    return state.status !== 'new';
  }
  if (input.kind === 'timer_fired') {
    return !Object.hasOwn(state.timers.armed, input.timerId);
  }
  if (input.kind === 'call_answered') {
    return !Object.hasOwn(state.calls.open, callKeyText(input.key));
  }
  return input.kind === 'event_received' ? state.inbox.receivedIds.includes(input.event.id) : state.cancelRequested;
}

export function isStale(state: RunState, input: RunInput): boolean {
  if (input.kind !== 'started' && (state.status !== 'running' || input.executionId !== state.executionId)) {
    return true;
  }
  return isSpent(state, input);
}
