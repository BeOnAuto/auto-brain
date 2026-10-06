import {
  BrainIdSchema,
  NotFound,
  UnavailableBecauseSchema,
  OrgIdSchema,
  streamPrefixOfBrain,
  type Conflict,
  type Lineage,
  type Settlement as RunSettlement,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, Option, Schema } from 'effect';

import type { ExecutionResult } from './execution-commands.ts';
import { executionDecider, executionStreamOf } from './execution-decider.ts';
import { executionOf } from './execution-lookup.ts';
import type { Run } from './execution.ts';
import { withinResultLimit } from './recorded-size.ts';

export interface ExecutionAddress {
  readonly org: string;
  readonly brain: string;
  readonly id: string;
}

export type Settlement =
  | { readonly status: 'succeeded'; readonly output: Schema.Json; readonly record: Schema.JsonObject }
  | Exclude<RunSettlement, { readonly status: 'succeeded' }>;

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

const decodeBecause = Schema.decodeUnknownOption(UnavailableBecauseSchema);

type Rejected = Extract<Settlement, { readonly status: 'rejected' }>;

function unfinishedRejection(detail: string, because: string | undefined): ExecutionResult {
  const known = Option.getOrUndefined(decodeBecause(because));
  return {
    type: 'execution_rejected',
    rejection: {
      reason: 'unavailable',
      detail,
      kind: 'tools_unfinished',
      ...(known === undefined ? {} : { because: known }),
    },
  };
}

function rejectionOf({ reason, detail, kind, because }: Rejected): ExecutionResult {
  if (reason === 'conflict') {
    return {
      type: 'execution_rejected',
      rejection: { reason, detail, ...(kind === 'tools_called' ? { kind } : {}) },
    };
  }
  if (reason === 'unavailable') {
    return kind === 'tools_unfinished'
      ? unfinishedRejection(detail, because)
      : { type: 'execution_rejected', rejection: { reason, detail } };
  }
  return { type: 'execution_rejected', rejection: { reason, detail, issues: [] } };
}

function streamOf(address: ExecutionAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address)
    ? Effect.succeed(`${streamPrefixOfBrain(address)}${executionStreamOf(address.id.toLowerCase())}`)
    : Effect.fail(new NotFound({ detail: 'There is no such run in this brain' }));
}

function resultOf(settlement: Settlement): Effect.Effect<ExecutionResult> {
  if (settlement.status === 'succeeded') {
    return decodeSuccess(settlement).pipe(
      Effect.orDie,
      Effect.tap(({ output, record }) => withinResultLimit(output, record)),
      Effect.map(({ output, record }): ExecutionResult => ({ type: 'execution_succeeded', output, record })),
    );
  }
  if (settlement.status === 'rejected') {
    return Effect.succeed(rejectionOf(settlement));
  }
  return Effect.succeed(failure);
}

export function executionSettler(ledger: StreamWriter): SettleExecution {
  const settle = Effect.fnUntraced(function* (stream: string, result: ExecutionResult, lineage?: Lineage) {
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* ledger.execute(stream, executionDecider, { type: 'settle', result, at }, lineage);
  });
  return (execution, settlement, lineage) =>
    Effect.gen(function* () {
      const stream = yield* streamOf(execution);
      const result = yield* resultOf(settlement).pipe(
        Effect.tapDefect(() => Effect.ignore(settle(stream, failure, lineage))),
      );
      const { state } = yield* settle(stream, result, lineage);
      return yield* executionOf(execution.id.toLowerCase(), state);
    });
}
