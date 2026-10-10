import { recordedWith, type Recorded, type TypedEvent } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { EncodedEvent, RecordedMessage } from './event-store.ts';

export interface EventCodec<Event extends TypedEvent> {
  readonly encode: (event: Event) => Effect.Effect<EncodedEvent>;
  readonly decode: (message: RecordedMessage) => Effect.Effect<Recorded<Event>>;
}

const asEncodedEvent = Schema.decodeUnknownEffect(Schema.Struct({ type: Schema.String, data: Schema.JsonObject }));

export function eventCodecOf<Event extends TypedEvent>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventCodec<Event> {
  const json = Schema.toCodecJson(eventSchema);
  const encodeJson = Schema.encodeUnknownEffect(json);
  const decodeJson = Schema.decodeUnknownEffect(json);
  return {
    encode: (event) => encodeJson(event).pipe(Effect.flatMap(asEncodedEvent), Effect.orDie),
    decode: ({ type, data, context }) =>
      Effect.orDie(decodeJson({ type, data })).pipe(Effect.map(recordedWith<Event>(context))),
  };
}
