import type { StreamReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { StreamStore } from './event-store.ts';
import { foldEvents } from './fold-events.ts';

export function streamReaderOf(store: StreamStore): StreamReader['load'] {
  return (stream, fold) =>
    Effect.gen(function* () {
      const recorded = yield* Effect.promise(() => store.read(stream));
      const events = yield* Effect.forEach(recorded.messages, eventCodecOf(fold.eventSchema).decode);
      return { state: foldEvents(fold.evolve, fold.initialState, events), version: recorded.version };
    });
}
