import type { TypedEvent } from '@beonauto/operations';
import { isExpectedVersionConflictError } from '@event-driven-io/emmett';
import { Effect, type Schema } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { EncodedEvent, StreamStore } from './event-store.ts';
import { VersionConflict } from './version-conflict.ts';

export type EventAppender = <Event extends TypedEvent>(
  stream: string,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
  events: readonly Event[],
  expectedVersion: number,
) => Effect.Effect<void, VersionConflict>;

export function eventAppenderOf(store: StreamStore): EventAppender {
  return (stream, eventSchema, events, expectedVersion) => {
    if (events.length > store.mostEventsInOneAppend) {
      return Effect.die(
        new RangeError(
          `A decision on ${stream} gave ${events.length} events, more than ${store.mostEventsInOneAppend}`,
        ),
      );
    }
    return Effect.forEach(events, eventCodecOf(eventSchema).encode).pipe(
      Effect.flatMap((encoded: readonly EncodedEvent[]) =>
        Effect.tryPromise({ try: () => store.append(stream, encoded, expectedVersion), catch: (error) => error }),
      ),
      Effect.catch((error) =>
        isExpectedVersionConflictError(error) ? Effect.fail(new VersionConflict()) : Effect.die(error),
      ),
    );
  };
}
