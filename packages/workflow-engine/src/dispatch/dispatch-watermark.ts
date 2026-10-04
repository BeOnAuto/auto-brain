import { Data, type Effect, type Schema } from 'effect';

import type { PositionedEvent } from '../run-log/run-event.ts';
import type { RunOutput } from './run-output.ts';

export interface DispatchWatermark {
  readonly read: (executionId: string) => Effect.Effect<number>;
  readonly advance: (executionId: string, through: number) => Effect.Effect<void>;
}

export interface RunContext {
  readonly executionId: string;
  readonly attributes: Schema.JsonObject;
}

export interface PositionedOutput {
  readonly version: number;
  readonly output: RunOutput;
}

export class DispatchFailed extends Data.TaggedError('dispatch_failed')<{
  readonly output: RunOutput['kind'];
  readonly detail: string;
}> {}

export function outputsAbove(watermark: number, events: readonly PositionedEvent[]): readonly PositionedOutput[] {
  return events
    .filter(({ version }) => version > watermark)
    .toSorted((first, second) => first.version - second.version)
    .flatMap(({ version, event }) => event.outputs.map((output) => ({ version, output })));
}
