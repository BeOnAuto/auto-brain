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

import type { OutboundCallFact } from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import type { ExecutionAddress } from '../execution/execution-settler.ts';

export interface RecordedOutboundCall {
  readonly id: string;
  readonly at: string;
}

export type RecordOutboundCall = (
  run: ExecutionAddress,
  fact: OutboundCallFact,
  lineage: Lineage,
) => Effect.Effect<RecordedOutboundCall, Conflict>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const noSuchRun = new Conflict({ detail: 'There is no such run in this brain, so it records no work' });

export function outboundCallRecorder(ledger: StreamWriter): RecordOutboundCall {
  return (run, fact, lineage) =>
    Effect.gen(function* () {
      if (!isWellFormed(run)) {
        return yield* noSuchRun;
      }
      const stream = `${streamPrefixOfBrain(run)}${executionStreamOf(run.id.toLowerCase())}`;
      const at = DateTime.formatIso(yield* DateTime.now);
      const { version } = yield* ledger
        .execute(stream, executionDecider, { type: 'outbound_call', fact, by: brainCallerOf(run).id, at }, lineage)
        .pipe(Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }));
      return { id: messageIdOf(stream, version), at };
    });
}
