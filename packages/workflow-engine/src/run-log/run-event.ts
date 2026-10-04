import { Schema } from 'effect';

import { RunOutputSchema } from '../dispatch/run-output.ts';
import { InputReceiptSchema } from '../machine/input-receipt.ts';
import { PatchOperationSchema } from './state-patch.ts';

export const RunEventSchema = Schema.Struct({
  type: Schema.Literal('input_applied'),
  receipt: InputReceiptSchema,
  patch: Schema.Array(PatchOperationSchema),
  outputs: Schema.Array(RunOutputSchema),
});

export type RunEvent = typeof RunEventSchema.Type;

export interface PositionedEvent {
  readonly version: number;
  readonly event: RunEvent;
}
