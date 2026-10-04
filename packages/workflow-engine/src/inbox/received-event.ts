import { Schema } from 'effect';

export const mostEventIdLength = 256;

export const mostWaitingEvents = 64;

export const mostWaitingEventBytes = 1_048_576;

export const mostReceivedEvents = 1024;

export const mostReceivedEventBytes = 4_194_304;

const EventIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostEventIdLength));

export const ReceivedEventSchema = Schema.StructWithRest(
  Schema.Struct({ id: EventIdSchema, type: Schema.NonEmptyString }),
  [Schema.Record(Schema.String, Schema.Json)],
);

export type ReceivedEvent = typeof ReceivedEventSchema.Type;
