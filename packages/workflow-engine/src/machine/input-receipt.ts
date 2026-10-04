import { Schema } from 'effect';

import { callKeyText } from '../executor/call-key.ts';
import { clampedAt, InstantSchema } from './instant.ts';
import type { RunInput } from './run-input.ts';

const keyed = {
  key: Schema.String,
  at: InstantSchema,
};

export const InputReceiptSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('started'), ...keyed }),
  Schema.Struct({ kind: Schema.Literal('timer_fired'), ...keyed }),
  Schema.Struct({
    kind: Schema.Literal('call_answered'),
    ...keyed,
    status: Schema.Literals(['succeeded', 'rejected', 'failed', 'unreachable']),
  }),
  Schema.Struct({ kind: Schema.Literal('event_received'), ...keyed, eventType: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('cancel_requested'), ...keyed }),
]);

export type InputReceipt = typeof InputReceiptSchema.Type;

export function receiptOf(input: RunInput, lastInputAt: number): InputReceipt {
  const at = clampedAt(lastInputAt, input.at);
  if (input.kind === 'timer_fired') {
    return { kind: input.kind, key: input.timerId, at };
  }
  if (input.kind === 'call_answered') {
    return { kind: input.kind, key: callKeyText(input.key), at, status: input.result.status };
  }
  if (input.kind === 'event_received') {
    return { kind: input.kind, key: input.event.id, at, eventType: input.event.type };
  }
  return { kind: input.kind, key: input.executionId, at };
}
