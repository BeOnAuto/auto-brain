import { Schema } from 'effect';

import { RunOutputSchema } from '../dispatch/run-output.ts';
import { InputReceiptSchema } from '../machine/input-receipt.ts';
import { mostEventBytes } from '../machine/limits.ts';
import { StateFormatSchema } from './state-format.ts';
import { PatchOperationSchema } from './state-patch.ts';

export const StepSchema = Schema.Struct({
  reference: Schema.String,
  run: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  outcome: Schema.Literals(['started', 'skipped', 'waiting', 'completed', 'raised', 'timed_out', 'cancelled']),
});

export const RunEventSchema = Schema.Struct({
  type: Schema.Literal('input_applied'),
  format: StateFormatSchema,
  receipt: InputReceiptSchema,
  steps: Schema.Array(StepSchema),
  patch: Schema.Array(PatchOperationSchema),
  outputs: Schema.Array(RunOutputSchema),
});

export type Step = typeof StepSchema.Type;

export type RunEvent = typeof RunEventSchema.Type;

export interface PositionedEvent {
  readonly version: number;
  readonly event: RunEvent;
}

const utf8 = new TextEncoder();

export function eventBytesOf(event: RunEvent): number {
  return utf8.encode(JSON.stringify(event)).byteLength;
}

export function fitsInOneEvent(event: RunEvent): boolean {
  return eventBytesOf(event) <= mostEventBytes;
}

function withHistoryBytesOf(event: RunEvent, historyBytes: number): RunEvent {
  return { ...event, patch: [...event.patch, { op: 'replace', path: '/historyBytes', value: historyBytes }] };
}

export function withHistoryBytes(event: RunEvent, before: number): RunEvent {
  const settled = (guess: number): RunEvent => {
    const counted = withHistoryBytesOf(event, before + guess);
    const bytes = eventBytesOf(counted);
    return bytes === guess ? counted : settled(bytes);
  };
  return settled(0);
}
