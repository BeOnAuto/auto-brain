import { Schema } from 'effect';

import { RunOutputSchema } from '../dispatch/run-output.ts';
import { InputReceiptSchema } from '../machine/input-receipt.ts';
import { mostEventBytes } from '../machine/limits.ts';
import { EarlierStepSchema, ResumedSchema, StepSchema } from '../steps/step-entry.ts';
import { StateFormatSchema } from './state-format.ts';
import { PatchOperationSchema } from './state-patch.ts';

export const RunLogEventSchema = Schema.Struct({
  type: Schema.Literal('input_applied'),
  format: StateFormatSchema,
  receipt: InputReceiptSchema,
  steps: Schema.Array(Schema.Union([StepSchema, EarlierStepSchema])),
  resumed: Schema.optionalKey(Schema.NullOr(ResumedSchema)),
  patch: Schema.Array(PatchOperationSchema),
  outputs: Schema.Array(RunOutputSchema),
});

export type RunLogEvent = typeof RunLogEventSchema.Type;

export interface PositionedEvent {
  readonly version: number;
  readonly event: RunLogEvent;
}

const utf8 = new TextEncoder();

export function eventBytesOf(event: RunLogEvent): number {
  return utf8.encode(JSON.stringify(event)).byteLength;
}

export function fitsInOneEvent(event: RunLogEvent): boolean {
  return eventBytesOf(event) <= mostEventBytes;
}

function withHistoryBytesOf(event: RunLogEvent, historyBytes: number): RunLogEvent {
  return { ...event, patch: [...event.patch, { op: 'replace', path: '/historyBytes', value: historyBytes }] };
}

export function withHistoryBytes(event: RunLogEvent, before: number): RunLogEvent {
  const settled = (guess: number): RunLogEvent => {
    const counted = withHistoryBytesOf(event, before + guess);
    const bytes = eventBytesOf(counted);
    return bytes === guess ? counted : settled(bytes);
  };
  return settled(0);
}
