import { Schema } from 'effect';

export const mostPublicEventDataBytes = 4096;

const utf8 = new TextEncoder();

function fitsInPublicEventData(data: Schema.JsonObject): boolean {
  return utf8.encode(JSON.stringify(data)).byteLength <= mostPublicEventDataBytes;
}

export const PublicEventSchema = Schema.Struct({
  id: Schema.String.annotate({
    description:
      'The id of the event, a UUID that stays the same on every read and that other events name as their cause',
  }),
  cursor: Schema.String.annotate({ description: 'The place to read on from, after this event, as `cursor`' }),
  causation_id: Schema.NullOr(Schema.String).annotate({
    description: 'The id of the event that directly led to this one, or null when nothing recorded did',
  }),
  at: Schema.String.annotate({ description: 'When it happened, by its own clock, in ISO 8601 UTC' }),
  type: Schema.String.annotate({ description: 'What kind of event it is, a stable public name' }),
  summary: Schema.String.annotate({ description: 'What happened, in plain words' }),
  data: Schema.JsonObject.annotate({
    description: `The facts of the event, at most ${mostPublicEventDataBytes} bytes as JSON in UTF-8`,
  }).check(
    Schema.makeFilter(fitsInPublicEventData, {
      expected: `data of at most ${mostPublicEventDataBytes} bytes as JSON in UTF-8`,
    }),
  ),
}).annotate({ identifier: 'PublicEvent', description: 'Something that happened in the brain, as a caller reads it' });

export type PublicEvent = typeof PublicEventSchema.Type;
