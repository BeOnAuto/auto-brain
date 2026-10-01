import type { TypedEvent } from '@beonauto/operations';
import { isExpectedVersionConflictError } from '@event-driven-io/emmett';
import { Effect, type Schema } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { EventStore, EncodedEvent } from './event-store.ts';
import { VersionConflict } from './version-conflict.ts';

const mostEventsInOneAppend = 8;

export type EventAppender = <Event extends TypedEvent>(
  stream: string,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
  events: readonly Event[],
  expectedVersion: number,
) => Effect.Effect<void, VersionConflict>;

export function eventAppenderOf(store: EventStore): EventAppender {
  return (stream, eventSchema, events, expectedVersion) => {
    if (events.length > mostEventsInOneAppend) {
      return Effect.die(
        new RangeError(`A decision on ${stream} gave ${events.length} events, more than ${mostEventsInOneAppend}`),
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
