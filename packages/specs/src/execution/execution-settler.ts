import {
  BrainIdSchema,
  NotFound,
  OrgIdSchema,
  brainCallerOf,
  streamPrefixOfBrain,
  type Conflict,
  type Lineage,
  type SettledRejection,
  type Settlement,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';
import { executionDecider, executionStreamOf } from './execution-decider.ts';
import { executionOf } from './execution-lookup.ts';
import type { ExecutionRejection, Run } from './execution.ts';
import { withinResultLimit } from './recorded-size.ts';

export type { Settlement } from '@beonauto/operations';

export interface ExecutionAddress {
  readonly org: string;
  readonly brain: string;
  readonly id: string;
}

export type SettleExecution = (
  execution: ExecutionAddress,
  settlement: Settlement,
  lineage?: Lineage,
) => Effect.Effect<Run, NotFound | Conflict>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeSuccess = Schema.decodeUnknownEffect(Schema.Struct({ output: Schema.Json, record: Schema.JsonObject }));

const failure: ExecutionResult = { type: 'execution_failed' };

function rejectionOf(settlement: SettledRejection): ExecutionRejection {
  if (settlement.reason === 'invalid_input') {
    return { reason: settlement.reason, detail: settlement.detail, issues: settlement.issues ?? [] };
  }
  if (settlement.reason === 'unavailable') {
    const { reason, detail, kind, because } = settlement;
    return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
  }
  if (settlement.reason === 'conflict') {
    const { reason, detail, kind } = settlement;
    return { reason, detail, ...(kind === undefined ? {} : { kind }) };
  }
  const { reason, detail, kind } = settlement;
  return { reason, detail, kind };
}

function rejectedWith(settlement: SettledRejection): Effect.Effect<ExecutionResult> {
  const { record } = settlement;
  const rejection = rejectionOf(settlement);
  return record === undefined
    ? Effect.succeed({ type: 'execution_rejected', rejection })
    : Effect.as(withinResultLimit(record), { type: 'execution_rejected', rejection, record });
}

function streamOf(address: ExecutionAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address)
    ? Effect.succeed(`${streamPrefixOfBrain(address)}${executionStreamOf(address.id.toLowerCase())}`)
    : Effect.fail(new NotFound({ detail: 'There is no such run in this brain' }));
}

function resultOf(settlement: Settlement): Effect.Effect<ExecutionResult> {
  if (settlement.status === 'succeeded') {
    return decodeSuccess({ output: settlement.output, record: settlement.record ?? {} }).pipe(
      Effect.orDie,
      Effect.tap(({ output, record }) => withinResultLimit(output, record)),
      Effect.map(({ output, record }): ExecutionResult => ({ type: 'execution_succeeded', output, record })),
    );
  }
  if (settlement.status === 'rejected') {
    return rejectedWith(settlement);
  }
  const { incident } = settlement;
  return Effect.succeed(incident === undefined ? failure : { type: 'execution_failed', incident });
}

export function executionSettler(ledger: StreamWriter): SettleExecution {
  const settle = Effect.fnUntraced(function* (stream: string, result: ExecutionResult, by: string, lineage?: Lineage) {
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* ledger.execute(stream, executionDecider, { type: 'settle', result, by, at }, lineage);
  });
  return (execution, settlement, lineage) =>
    Effect.gen(function* () {
      const stream = yield* streamOf(execution);
      const by = settlement.by ?? brainCallerOf(execution).id;
      const result = yield* resultOf(settlement).pipe(
        Effect.tapDefect(() => Effect.ignore(settle(stream, failure, by, lineage))),
      );
      const { state } = yield* settle(stream, result, by, lineage);
      return yield* executionOf(execution.id.toLowerCase(), state);
    });
}
