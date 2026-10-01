import type { TypedEvent } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { RecordedEvent } from './event-store.ts';

export interface EventCodec<Event extends TypedEvent> {
  readonly record: (event: Event) => Effect.Effect<RecordedEvent>;
  readonly recall: (data: unknown) => Effect.Effect<Event>;
}

const asJsonObject = Schema.decodeUnknownEffect(Schema.JsonObject);

export function eventCodecOf<Event extends TypedEvent>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventCodec<Event> {
  const json = Schema.toCodecJson(eventSchema);
  const encode = Schema.encodeUnknownEffect(json);
  const decode = Schema.decodeUnknownEffect(json);
  return {
    record: (event) =>
      encode(event).pipe(
        Effect.flatMap(asJsonObject),
        Effect.map((data) => ({ type: event.type, data })),
        Effect.orDie,
      ),
    recall: (data) => Effect.orDie(decode(data)),
  };
}
