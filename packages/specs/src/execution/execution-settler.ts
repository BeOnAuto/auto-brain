import {
  BrainIdSchema,
  NotFound,
  OrgIdSchema,
  brainCallerOf,
  streamPrefixOfBrain,
  type Conflict,
  type Lineage,
  type Rejection,
  type SettledRejection,
  type Settlement,
  type StreamState,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, Schema } from 'effect';

import type { ExecutionResult, ExecutionSettlement } from './execution-commands.ts';
import { executionDecider, executionDeciderAsRead, executionStreamOf } from './execution-decider.ts';
import { executionOf } from './execution-lookup.ts';
import type { ExecutionStreamState } from './execution-state.ts';
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

type SettleAsRead = (
  execution: ExecutionAddress,
  settlement: Settlement,
  readAt: number,
  lineage?: Lineage,
) => Effect.Effect<Run, NotFound | Conflict>;

type SettledOn = (
  stream: string,
  command: ExecutionSettlement,
  lineage: Lineage | undefined,
) => Effect.Effect<StreamState<ExecutionStreamState>, Rejection<'not_found' | 'conflict' | 'cancelled'>>;

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
  if (settlement.reason === 'unanswered') {
    const { reason, detail, kind } = settlement;
    return { reason, detail, kind };
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

const noSuchRun = new NotFound({ detail: 'There is no such run in this brain' });

function streamOf(address: ExecutionAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address)
    ? Effect.succeed(`${streamPrefixOfBrain(address)}${executionStreamOf(address.id.toLowerCase())}`)
    : Effect.fail(noSuchRun);
}

function brainStreamOf(address: ExecutionAddress): Effect.Effect<string, NotFound> {
  return isWellFormed(address) ? Effect.succeed(executionStreamOf(address.id.toLowerCase())) : Effect.fail(noSuchRun);
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

function settledOnLatest(ledger: StreamWriter): SettledOn {
  return (stream, command, lineage) => ledger.execute(stream, executionDecider, command, lineage);
}

function settledOnRead(ledger: StreamWriter, readAt: number): SettledOn {
  return (stream, command, lineage) =>
    Effect.map(ledger.execute(stream, executionDeciderAsRead, { readAt, command }, lineage), ({ state, version }) => ({
      state: state.state,
      version,
    }));
}

function settlerOver(
  settledOn: SettledOn,
  streamNamed: (address: ExecutionAddress) => Effect.Effect<string, NotFound>,
): SettleExecution {
  const settle = Effect.fnUntraced(function* (stream: string, result: ExecutionResult, by: string, lineage?: Lineage) {
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* settledOn(stream, { type: 'settle', result, by, at }, lineage).pipe(
      Effect.catchTag('cancelled', Effect.die),
    );
  });
  return (execution, settlement, lineage) =>
    Effect.gen(function* () {
      const stream = yield* streamNamed(execution);
      const by = settlement.by ?? brainCallerOf(execution).id;
      const result = yield* resultOf(settlement).pipe(
        Effect.tapDefect(() => Effect.ignore(settle(stream, failure, by, lineage))),
      );
      const { state } = yield* settle(stream, result, by, lineage);
      return yield* executionOf(execution.id.toLowerCase(), state);
    });
}

export function executionSettler(ledger: StreamWriter): SettleExecution {
  return settlerOver(settledOnLatest(ledger), streamOf);
}

export function executionSettlerAsRead(ledger: StreamWriter): SettleAsRead {
  return (execution, settlement, readAt, lineage) =>
    settlerOver(settledOnRead(ledger, readAt), streamOf)(execution, settlement, lineage);
}

export function brainBoundSettler(writer: StreamWriter): SettleExecution {
  return settlerOver(settledOnLatest(writer), brainStreamOf);
}
