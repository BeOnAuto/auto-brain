import { BrainIdSchema, OrgIdSchema, streamPrefixOfBrain, type StreamReader } from '@beonauto/operations';
import { Effect, Option, Schema } from 'effect';

import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { RunEventSchema, type RunEvent } from '../runs/run-events.ts';
import { runDetailOf } from '../runs/run-lookup.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import { startedRunOf, takesSettlement, type RunStreamState } from '../runs/run-state.ts';
import type { RunDetail } from '../runs/run.ts';

export interface RecordedRun {
  readonly run: RunDetail;
  readonly input: Schema.Json;
  readonly awaitsSettlement: boolean;
  readonly lastCall: number;
}

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeRunEvent = Schema.decodeUnknownOption(Schema.toCodecJson(RunEventSchema));

export function runEventOf(data: unknown): RunEvent | undefined {
  return Option.getOrUndefined(decodeRunEvent(data));
}

function recordedOf(id: string, state: RunStreamState): Effect.Effect<RecordedRun | undefined> {
  const run = startedRunOf(state);
  return run === undefined
    ? Effect.undefined
    : Effect.map(Effect.orDie(runDetailOf(id, state)), (detail) => ({
        run: detail,
        input: run.input,
        awaitsSettlement: takesSettlement(run),
        lastCall: run.lastCall,
      }));
}

export function recordedRunIn(reader: StreamReader, address: RunStreamAddress): Effect.Effect<RecordedRun | undefined> {
  if (!isWellFormed(address)) {
    return Effect.undefined;
  }
  const id = address.id.toLowerCase();
  return reader
    .load(`${streamPrefixOfBrain(address)}${runStreamNameOf(id)}`, runDecider)
    .pipe(Effect.flatMap(({ state }) => recordedOf(id, state)));
}

export function recordedRunInBrain(reader: StreamReader, id: string): Effect.Effect<RecordedRun | undefined> {
  const run = id.toLowerCase();
  return reader.load(runStreamNameOf(run), runDecider).pipe(Effect.flatMap(({ state }) => recordedOf(run, state)));
}
