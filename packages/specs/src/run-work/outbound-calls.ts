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

import type {
  CommandMetadata,
  ExecutionCommand,
  OutboundCallFact,
  ReplyFact,
} from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import type { ExecutionAddress } from '../execution/execution-settler.ts';

export interface RecordedOutboundCall {
  readonly id: string;
  readonly at: string;
}

export type RecordRunWork<Fact> = (
  run: ExecutionAddress,
  fact: Fact,
  lineage: Lineage,
) => Effect.Effect<RecordedOutboundCall, Conflict>;

export type RecordOutboundCall = RecordRunWork<OutboundCallFact>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const noSuchRun = new Conflict({ detail: 'There is no such run in this brain, so it records no work' });

type CommandOf<Fact> = (fact: Fact, recorded: CommandMetadata) => ExecutionCommand;

function runWorkRecorder<Fact>(ledger: StreamWriter, commandOf: CommandOf<Fact>): RecordRunWork<Fact> {
  return (run, fact, lineage) =>
    Effect.gen(function* () {
      if (!isWellFormed(run)) {
        return yield* noSuchRun;
      }
      const stream = `${streamPrefixOfBrain(run)}${executionStreamOf(run.id.toLowerCase())}`;
      const at = DateTime.formatIso(yield* DateTime.now);
      const { version } = yield* ledger
        .execute(stream, executionDecider, commandOf(fact, { by: brainCallerOf(run).id, at }), lineage)
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
