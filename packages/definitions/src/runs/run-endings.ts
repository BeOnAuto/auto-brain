import { recordedDecoder, type Recorded } from '@beonauto/operations';
import { Option } from 'effect';

import { RunEventSchema, type RunCancelRequested, type RunEvent, type RunFinished } from './run-events.ts';

export type RunEnding = Recorded<RunFinished>;

export type CancelRequested = Recorded<RunCancelRequested>;

const decodeRunEvent = recordedDecoder(RunEventSchema);

function isEnding(event: Recorded<RunEvent>): event is RunEnding {
  return event.type === 'run_succeeded' || event.type === 'run_rejected' || event.type === 'run_failed';
}

function isCancelRequest(event: Recorded<RunEvent>): event is CancelRequested {
  return event.type === 'run_cancel_requested';
}

export function runEndingOf(recorded: unknown): RunEnding | undefined {
  return Option.getOrUndefined(Option.filter(decodeRunEvent(recorded), isEnding));
}

export function lastEndingOf(recorded: readonly unknown[]): RunEnding | undefined {
  return runEndingOf(recorded.at(-1));
}

export function cancelRequestOf(recorded: unknown): CancelRequested | undefined {
  return Option.getOrUndefined(Option.filter(decodeRunEvent(recorded), isCancelRequest));
}
