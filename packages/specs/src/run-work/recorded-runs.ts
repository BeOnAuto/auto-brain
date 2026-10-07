import { BrainIdSchema, OrgIdSchema, streamPrefixOfBrain, type StreamReader } from '@beonauto/operations';
import { Effect, Option, Schema } from 'effect';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import { executionDetailOf } from '../execution/execution-lookup.ts';
import type { ExecutionAddress } from '../execution/execution-settler.ts';
import { runOf, takesSettlement, type ExecutionStreamState } from '../execution/execution-state.ts';
import type { RunDetail } from '../execution/execution.ts';

export interface RecordedRun {
  readonly run: RunDetail;
  readonly input: Schema.Json;
  readonly awaitsSettlement: boolean;
  readonly lastCall: number;
}

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeExecutionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(ExecutionEventSchema));

export function executionEventOf(data: unknown): ExecutionEvent | undefined {
  return Option.getOrUndefined(decodeExecutionEvent(data));
}

function recordedOf(id: string, state: ExecutionStreamState): Effect.Effect<RecordedRun | undefined> {
  const run = runOf(state);
  return run === undefined
    ? Effect.undefined
    : Effect.map(Effect.orDie(executionDetailOf(id, state)), (detail) => ({
        run: detail,
        input: run.input,
        awaitsSettlement: takesSettlement(run),
        lastCall: run.lastCall,
      }));
}

export function recordedRunIn(reader: StreamReader, address: ExecutionAddress): Effect.Effect<RecordedRun | undefined> {
  if (!isWellFormed(address)) {
    return Effect.undefined;
  }
  const id = address.id.toLowerCase();
  return reader
    .load(`${streamPrefixOfBrain(address)}${executionStreamOf(id)}`, executionDecider)
    .pipe(Effect.flatMap(({ state }) => recordedOf(id, state)));
}

export function recordedRunInBrain(reader: StreamReader, id: string): Effect.Effect<RecordedRun | undefined> {
  const run = id.toLowerCase();
  return reader
    .load(executionStreamOf(run), executionDecider)
    .pipe(Effect.flatMap(({ state }) => recordedOf(run, state)));
}
