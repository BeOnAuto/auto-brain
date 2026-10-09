import { streamPrefixOfBrain } from '@beonauto/operations';
import { callKeyText, DispatchFailed, type ListenerArmReceipt, type Listeners } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { Refusals } from '../reactions/refusals.ts';
import { reactionOfRun } from '../reactions/run-attributes.ts';
import { addressOfRun, runLogStreamOf } from '../runs/run-address.ts';
import { insertedListener, isListening, listenersInBrain, removedListener } from './listener-rows.ts';

export const mostListenersInABrain = 4096;

function failedTo(output: 'arm_listener' | 'cancel_listener') {
  return ({ detail }: Readonly<{ detail: string }>) => new DispatchFailed({ output, detail });
}

export function sqlListeners(database: HostDatabase, refusals: Refusals): Listeners {
  return {
    arm: (output, run, origin) =>
      Effect.gen(function* () {
        const runKey = run.runId;
        const place = { runKey, listener: callKeyText(output.key) };
        if (yield* isListening(database, place)) {
          return 'already_armed';
        }
        const brainKey = streamPrefixOfBrain(addressOfRun(runKey));
        const { workflow } = reactionOfRun(run.attributes);
        if ((yield* listenersInBrain(database, brainKey)) >= mostListenersInABrain) {
          yield* refusals.refuse(
            brainKey,
            workflow,
            `A run listened for events of the brain while ${mostListenersInABrain} listeners were already open in it, the most a brain keeps; the run takes only the events sent to it`,
          );
          return 'refused';
        }
        yield* insertedListener(database, {
          ...place,
          brainKey,
          streamId: runLogStreamOf(runKey),
          armedBy: origin.version,
          filters: JSON.stringify(output.filters),
          workflow,
          passed: false,
        });
        return 'armed';
      }).pipe(
        Effect.map((receipt): ListenerArmReceipt => receipt),
        Effect.mapError(failedTo('arm_listener')),
      ),
    cancel: (output, run) =>
      removedListener(database, { runKey: run.runId, listener: callKeyText(output.key) }).pipe(
        Effect.map((removed) => (removed ? 'cancelled' : 'not_armed')),
        Effect.mapError(failedTo('cancel_listener')),
      ),
  };
}
