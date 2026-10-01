import type { StreamReader } from '@beonauto/operations';
import { Effect } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { EventStore } from './event-store.ts';
import { evolved } from './evolved.ts';

export function streamLoaderOf(store: EventStore): StreamReader['load'] {
  return (stream, decider) =>
    Effect.gen(function* () {
      const recorded = yield* Effect.promise(() => store.read(stream));
      const events = yield* Effect.forEach(recorded.events, eventCodecOf(decider.eventSchema).recall);
      return { state: evolved(decider.evolve, decider.initialState, events), version: recorded.version };
    });
}
