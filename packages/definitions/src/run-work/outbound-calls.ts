import {
  BrainIdSchema,
  Conflict,
  OrgIdSchema,
  brainCallerOf,
  messageIdOf,
  streamPrefixOfBrain,
  type Lineage,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, Schema } from 'effect';

import type { CommandMetadata, RunCommand, OutboundCallFact, ReplyFact } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';

export interface RecordedOutboundCall {
  readonly id: string;
  readonly at: string;
}

export type RecordRunWork<Fact> = (
  run: RunStreamAddress,
  fact: Fact,
  lineage: Lineage,
) => Effect.Effect<RecordedOutboundCall, Conflict>;

export type RecordOutboundCall = RecordRunWork<OutboundCallFact>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const noSuchRun = new Conflict({ detail: 'There is no such run in this brain, so it records no work' });

type CommandOf<Fact> = (fact: Fact, recorded: CommandMetadata) => RunCommand;

function runWorkRecorder<Fact>(ledger: StreamWriter, commandOf: CommandOf<Fact>): RecordRunWork<Fact> {
  return (run, fact, lineage) =>
    Effect.gen(function* () {
      if (!isWellFormed(run)) {
        return yield* noSuchRun;
      }
      const runId = run.id.toLowerCase();
      const stream = `${streamPrefixOfBrain(run)}${runStreamNameOf(runId)}`;
      const at = DateTime.formatIso(yield* DateTime.now);
      const { version } = yield* ledger
        .execute(stream, runDecider, commandOf(fact, { runId, by: brainCallerOf(run).id, at }), lineage)
        .pipe(Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }));
      return { id: messageIdOf(stream, version), at };
    });
}

export function outboundCallRecorder(ledger: StreamWriter): RecordOutboundCall {
  return runWorkRecorder(ledger, (fact: OutboundCallFact, recorded) => ({ type: 'outbound_call', fact, ...recorded }));
}

export function replyRecorder(ledger: StreamWriter): RecordRunWork<ReplyFact> {
  return runWorkRecorder(ledger, (fact: ReplyFact, recorded) => ({ type: 'reply', fact, ...recorded }));
}
