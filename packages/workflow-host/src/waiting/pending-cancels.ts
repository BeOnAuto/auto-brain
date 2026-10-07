import { messageIdOf, streamPrefixOfBrain } from '@beonauto/operations';
import { cancelRequestOf } from '@beonauto/specs';
import type { CancelOrder } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { RunAddress } from '../runs/run-address.ts';

export interface PendingCancel {
  readonly cancel: CancelOrder;
  readonly cause: string;
}

const isStart = Schema.is(Schema.Struct({ type: Schema.Literal('execution_started') }));

function isCancelRequest(data: unknown): boolean {
  return cancelRequestOf(data) !== undefined;
}

export function pendingCancelOf(database: HostDatabase, run: RunAddress): Effect.Effect<PendingCancel | undefined> {
  const stream = `${streamPrefixOfBrain(run)}executions/${run.executionId}`;
  return Effect.map(
    Effect.promise(() => database.store.read(stream, 0)),
    ({ events }): PendingCancel | undefined => {
      const started = events.findLastIndex((data) => isStart(data));
      const asked = events.findIndex((data, index) => index > started && isCancelRequest(data));
      const request = cancelRequestOf(events[asked]);
      return request === undefined
        ? undefined
        : {
            cancel: { by: request.by, kind: request.kind, reason: request.reason },
            cause: messageIdOf(stream, asked + 1),
          };
    },
  );
}
