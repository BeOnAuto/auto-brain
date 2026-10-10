import { streamPrefixOfBrain } from '@beonauto/operations';
import { callKeyText, DispatchFailed, type ListenerArmReceipt, type Listeners } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { FilterPlace, FilterStops } from '../filtering/filter-matching.ts';
import type { Refusals } from '../reactions/refusals.ts';
import { reactionOfRun } from '../reactions/run-attributes.ts';
import { addressOfRun, runLogStreamOf } from '../runs/run-address.ts';
import {
  insertedListener,
  isListening,
  isListeningAt,
  listenersInBrain,
  removedListener,
  type ListeningPlace,
} from './listener-rows.ts';

export const mostListenersInABrain = 4096;

function failedTo(output: 'arm_listener' | 'cancel_listener') {
  return ({ detail }: Readonly<{ detail: string }>) => new DispatchFailed({ output, detail });
}

function stopsForgotten(database: HostDatabase, stops: FilterStops, place: ListeningPlace) {
  const filterPlace: FilterPlace = { kind: 'listener', ...place };
  if (!stops.holds(filterPlace)) {
    return Effect.void;
  }
  return Effect.map(isListeningAt(database, place), (listening) => {
    if (!listening) {
      stops.listenerEnded(filterPlace);
    }
  });
}

export function sqlListeners(database: HostDatabase, refusals: Refusals, stops: FilterStops): Listeners {
  return {
    arm: (output, run, origin) =>
      Effect.gen(function* () {
        const runKey = run.runId;
        const place = { runKey, listener: callKeyText(output.key) };
        if (yield* isListening(database, place)) {
          return 'already_armed';
        }
        const brainKey = streamPrefixOfBrain(addressOfRun(runKey));
        const { workflow, version } = reactionOfRun(run.attributes);
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
          version,
          passed: false,
        });
        return 'armed';
      }).pipe(
        Effect.map((receipt): ListenerArmReceipt => receipt),
        Effect.mapError(failedTo('arm_listener')),
      ),
    cancel: (output, run) =>
      Effect.gen(function* () {
        const removed = yield* removedListener(database, { runKey: run.runId, listener: callKeyText(output.key) });
        const { workflow, version } = reactionOfRun(run.attributes);
        const brainKey = streamPrefixOfBrain(addressOfRun(run.runId));
        yield* stopsForgotten(database, stops, { brainKey, workflow, version, reference: output.key.reference });
        return removed ? 'cancelled' : 'not_armed';
      }).pipe(Effect.mapError(failedTo('cancel_listener'))),
  };
}
