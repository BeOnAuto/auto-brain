import type { TypedEvent } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { EncodedEvent } from './event-store.ts';

export interface EventCodec<Event extends TypedEvent> {
  readonly encode: (event: Event) => Effect.Effect<EncodedEvent>;
  readonly decode: (data: unknown) => Effect.Effect<Event>;
}

const asJsonObject = Schema.decodeUnknownEffect(Schema.JsonObject);

export function eventCodecOf<Event extends TypedEvent>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventCodec<Event> {
  const json = Schema.toCodecJson(eventSchema);
  const encodeJson = Schema.encodeUnknownEffect(json);
  const decodeJson = Schema.decodeUnknownEffect(json);
  return {
    encode: (event) =>
      encodeJson(event).pipe(
        Effect.flatMap(asJsonObject),
        Effect.map((data) => ({ type: event.type, data })),
        Effect.orDie,
      ),
    decode: (data) => Effect.orDie(decodeJson(data)),
  };
}
