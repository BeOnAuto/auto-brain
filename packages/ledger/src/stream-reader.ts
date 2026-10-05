import type { StreamReader } from '@beonauto/operations';
import { Effect } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { StreamStore } from './event-store.ts';
import { foldEvents } from './fold-events.ts';

export function streamReaderOf(store: StreamStore): StreamReader['load'] {
  return (stream, decider) =>
    Effect.gen(function* () {
      const recorded = yield* Effect.promise(() => store.read(stream));
      const events = yield* Effect.forEach(recorded.events, eventCodecOf(decider.eventSchema).decode);
      return { state: foldEvents(decider.evolve, decider.initialState, events), version: recorded.version };
    });
}
