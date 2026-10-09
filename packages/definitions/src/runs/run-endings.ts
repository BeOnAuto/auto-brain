import { Option, Schema } from 'effect';

import { RunEventSchema, type RunCancelRequested, type RunFinished } from './run-events.ts';

export type RunEnding = RunFinished;

export type CancelRequested = RunCancelRequested;

const decodeRunEvent = Schema.decodeUnknownOption(Schema.toCodecJson(RunEventSchema));

function isEnding(event: Schema.Schema.Type<typeof RunEventSchema>): event is RunEnding {
  return event.type === 'run_succeeded' || event.type === 'run_rejected' || event.type === 'run_failed';
}

export function runEndingOf(data: unknown): RunEnding | undefined {
  return Option.getOrUndefined(Option.filter(decodeRunEvent(data), isEnding));
}

export function lastEndingOf(events: readonly unknown[]): RunEnding | undefined {
  return runEndingOf(events.at(-1));
}

export function cancelRequestOf(data: unknown): CancelRequested | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodeRunEvent(data), (event) =>
      event.type === 'run_cancel_requested' ? Option.some(event) : Option.none(),
    ),
  );
}
