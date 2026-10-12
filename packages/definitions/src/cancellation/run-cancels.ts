import {
  PlaybookIdSchema,
  OrgIdSchema,
  playbookCallerOf,
  streamPrefixOfPlaybook,
  type Conflict,
  type Lineage,
  type StreamWriter,
} from '@on.auto/operations';
import { DateTime, Effect, Equal, Schema } from 'effect';

import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { endedBeforeCancelling } from '../runs/run-decisions.ts';
import type { CancelRequestKind } from '../runs/run-events.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';

export interface CancelRequest {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by?: string;
}

export type CancelReceipt = 'requested' | 'ended' | 'unknown_run';

export type CancelRun = (
  run: RunStreamAddress,
  request: CancelRequest,
  lineage: Lineage,
) => Effect.Effect<CancelReceipt, Conflict>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

function endedFirst(error: unknown): boolean {
  return Equal.equals(error, endedBeforeCancelling);
}

export function runCanceller(ledger: StreamWriter): CancelRun {
  return (run, { kind, reason, by }, lineage) =>
    Effect.gen(function* () {
      if (!isWellFormed(run)) {
        return 'unknown_run';
      }
      const runId = run.id.toLowerCase();
      const stream = `${streamPrefixOfPlaybook(run)}${runStreamNameOf(runId)}`;
      const at = DateTime.formatIso(yield* DateTime.now);
      const actor = by ?? playbookCallerOf(run).id;
      const cancel = { type: 'cancel', kind, reason, runId, by: actor, at, byItsCaller: true } as const;
      return yield* ledger.execute(stream, runDecider, cancel, lineage).pipe(
        Effect.as<CancelReceipt>('requested'),
        Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }),
        Effect.catchIf(endedFirst, () => Effect.succeed<CancelReceipt>('ended')),
      );
    });
}
