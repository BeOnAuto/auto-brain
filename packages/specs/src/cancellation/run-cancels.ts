import {
  BrainIdSchema,
  OrgIdSchema,
  brainCallerOf,
  streamPrefixOfBrain,
  type Conflict,
  type Lineage,
  type StreamWriter,
} from '@beonauto/operations';
import { DateTime, Effect, Equal, Schema } from 'effect';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { endedBeforeCancelling } from '../execution/execution-decisions.ts';
import type { CancelRequestKind } from '../execution/execution-events.ts';
import type { ExecutionAddress } from '../execution/execution-settler.ts';

export interface CancelRequest {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by?: string;
}

export type CancelReceipt = 'requested' | 'ended' | 'unknown_run';

export type CancelExecution = (
  execution: ExecutionAddress,
  request: CancelRequest,
  lineage: Lineage,
) => Effect.Effect<CancelReceipt, Conflict>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, brain: BrainIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

function endedFirst(error: unknown): boolean {
  return Equal.equals(error, endedBeforeCancelling);
}

export function executionCanceller(ledger: StreamWriter): CancelExecution {
  return (execution, { kind, reason, by }, lineage) =>
    Effect.gen(function* () {
      if (!isWellFormed(execution)) {
        return 'unknown_run';
      }
      const stream = `${streamPrefixOfBrain(execution)}${executionStreamOf(execution.id.toLowerCase())}`;
      const at = DateTime.formatIso(yield* DateTime.now);
      const actor = by ?? brainCallerOf(execution).id;
      return yield* ledger
        .execute(stream, executionDecider, { type: 'cancel', kind, reason, by: actor, at, byItsCaller: true }, lineage)
        .pipe(
          Effect.as<CancelReceipt>('requested'),
          Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }),
          Effect.catchIf(endedFirst, () => Effect.succeed<CancelReceipt>('ended')),
        );
    });
}
