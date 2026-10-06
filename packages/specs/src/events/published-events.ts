import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { Conflict, type Decider } from '@beonauto/operations';
import { Effect, Equal, Result, Schema } from 'effect';

import { CloudEventSchema, type CloudEvent } from './cloud-event.ts';

const FilledAttributeSchema = Schema.Literals(['id', 'time']);

export type FilledAttribute = typeof FilledAttributeSchema.Type;

export const EventPublishedSchema = Schema.Struct({
  type: Schema.Literal('event_published'),
  event: CloudEventSchema,
  filled: Schema.Array(FilledAttributeSchema),
  by: Schema.String,
  at: Schema.String,
});

export type EventPublished = typeof EventPublishedSchema.Type;

export type PublishEvent = Omit<EventPublished, 'type'>;

export type PublishedEventState = EventPublished | undefined;

const publishedEvents = Buffer.from('e897efc8cb4b47b2b2ba2be1a76aeefb', 'hex');

const anotherEvent = new Conflict({
  detail: 'Another event was published with this source and id; give a different event an id of its own',
});

function given(event: CloudEvent, filled: ReadonlySet<string>): Schema.JsonObject {
  return Object.fromEntries(
    Object.entries(event).filter(([attribute]: readonly [string, Schema.Json]) => !filled.has(attribute)),
  );
}

function isSameEvent(published: EventPublished, { event, filled }: PublishEvent): boolean {
  const filledOnEitherSide = new Set([...published.filled, ...filled]);
  return Equal.equals(given(published.event, filledOnEitherSide), given(event, filledOnEitherSide));
}

function decideOnPublishing(
  publish: PublishEvent,
  published: PublishedEventState,
): Result.Result<readonly EventPublished[], Conflict> {
  if (published === undefined) {
    return Result.succeed([{ type: 'event_published', ...publish }]);
  }
  return isSameEvent(published, publish) ? Result.succeed([]) : Result.fail(anotherEvent);
}

export const publishedEventDecider: Decider<PublishedEventState, PublishEvent, EventPublished, 'conflict'> = {
  initialState: undefined,
  evolve: (_earlier, published) => published,
  decide: decideOnPublishing,
  eventSchema: EventPublishedSchema,
};

export function publishedEventStreamOf(source: string, id: string): string {
  const hash = createHash('sha1')
    .update(publishedEvents)
    .update(JSON.stringify([source, id]), 'utf8')
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.toString('hex', 0, 16);
  return `events/${[hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')}`;
}

export function recordedPublication(state: PublishedEventState): Effect.Effect<EventPublished> {
  return state === undefined
    ? Effect.die(new Error('The stream of a published event holds no event once it is published'))
    : Effect.succeed(state);
}
