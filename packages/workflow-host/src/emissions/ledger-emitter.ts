import { messageIdOf } from '@beonauto/operations';
import type { EmitEvent } from '@beonauto/specs';
import { DispatchFailed, type Emitter } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import { reactionOfRun } from '../reactions/run-attributes.ts';
import { addressOfRun, streamOfRun } from '../runs/run-address.ts';

export function ledgerEmitter(emit: EmitEvent, now: () => number): Emitter {
  return {
    emit: (emission, run, origin) => {
      const address = addressOfRun(run.executionId);
      const { workflow, version, caller, depth, correlation } = reactionOfRun(run.attributes);
      const lineage = {
        causationId: messageIdOf(streamOfRun(run.executionId), origin.version),
        correlationId: correlation ?? address.executionId,
      };
      return emit(
        address,
        {
          event: emission.event,
          emitter: { execution_id: address.executionId, workflow, version },
          depth: depth + 1,
          by: caller,
          at: new Date(now()).toISOString(),
        },
        lineage,
      ).pipe(
        Effect.mapError(
          ({ detail }: Readonly<{ detail: string }>) => new DispatchFailed({ output: 'emit_event', detail }),
        ),
      );
    },
  };
}
