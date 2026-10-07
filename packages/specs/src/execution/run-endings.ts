import { Option, Schema } from 'effect';

import { ExecutionEventSchema, type ExecutionCancelRequested, type ExecutionFinished } from './execution-events.ts';

export type RunEnding = ExecutionFinished;

export type CancelRequested = ExecutionCancelRequested;

const decodeExecutionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(ExecutionEventSchema));

function isEnding(event: Schema.Schema.Type<typeof ExecutionEventSchema>): event is RunEnding {
  return (
    event.type === 'execution_succeeded' || event.type === 'execution_rejected' || event.type === 'execution_failed'
  );
}

export function runEndingOf(data: unknown): RunEnding | undefined {
  return Option.getOrUndefined(Option.filter(decodeExecutionEvent(data), isEnding));
}

export function lastEndingOf(events: readonly unknown[]): RunEnding | undefined {
  return runEndingOf(events.at(-1));
}

export function cancelRequestOf(data: unknown): CancelRequested | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodeExecutionEvent(data), (event) =>
      event.type === 'execution_cancel_requested' ? Option.some(event) : Option.none(),
    ),
  );
}
