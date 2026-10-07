import { BrainWriter, InvalidInput, defineCommand, quoted, randomUUIDv7, type Issue } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { jsonBytesOf } from '../execution/recorded-size.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { EventToPublishSchema, mostPublishedEventBytes, type CloudEvent, type EventToPublish } from './cloud-event.ts';
import {
  publishedEventDecider,
  publishedEventStreamOf,
  recordedPublication,
  type FilledAttribute,
} from './published-events.ts';
import { refusingTheBrainsOwnAttributes } from './reserved-attributes.ts';

interface Publication {
  readonly event: CloudEvent;
  readonly filled: readonly FilledAttribute[];
}

const fillable: readonly FilledAttribute[] = ['id', 'time'];

function publicationOf(event: EventToPublish, at: string): Publication {
  return {
    event: { specversion: '1.0', ...event, id: event.id ?? randomUUIDv7(), time: event.time ?? at },
    filled: fillable.filter((attribute) => event[attribute] === undefined),
  };
}

function refusalsOf(event: CloudEvent): readonly Issue[] {
  const bytes = jsonBytesOf(event);
  return bytes > mostPublishedEventBytes
    ? [
        {
          detail: `Expected an event of at most ${mostPublishedEventBytes} bytes as JSON in UTF-8 with its id and time, not ${bytes}`,
          pointer: '/event',
        },
      ]
    : [];
}

const PublishedSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the event, as given or as the brain made it' }),
  time: Schema.String.annotate({
    description: 'When the event happened, in RFC 3339: as given, or when the brain recorded it',
  }),
  recorded_at: Schema.String.annotate({ description: 'When the brain recorded the event, in ISO 8601 UTC' }),
});

export const publishEvent = defineCommand('brain', {
  name: 'publish_event',
  title: 'Publish event',
  description: [
    'Publishes an event to the brain, where a workflow whose schedule names its type starts a run and a recall function that filters on it folds it,',
    'and returns its id and time.',
    'Use it when something outside the brain happened that the brain should react to or remember; send_execution_event gives an event to one waiting run instead.',
    '`event` is a CloudEvents event with a `source` and a `type`, and publishing the same source and id again records nothing, so a call can be retried with its id.',
    "The brain's own types and sources, such as those of its runs and definitions, are refused.",
  ].join(' '),
  route: { method: 'POST', path: '/events' },
  inputSchema: Schema.Struct({ event: EventToPublishSchema.check(refusingTheBrainsOwnAttributes) }),
  outputSchema: PublishedSchema,
  reasons: ['invalid_input', 'conflict'],
  handle: Effect.fnUntraced(function* ({ event }) {
    const { by, at } = yield* commandMetadata;
    const publication = publicationOf(event, at);
    const issues = refusalsOf(publication.event);
    if (issues.length > 0) {
      return yield* new InvalidInput({ detail: 'The event cannot be published as it is', issues });
    }
    const { state } = yield* (yield* BrainWriter).execute(
      publishedEventStreamOf(publication.event.source, publication.event.id),
      publishedEventDecider,
      { ...publication, by, at },
    );
    const recorded = yield* recordedPublication(state);
    return { id: recorded.event.id, time: recorded.event.time, recorded_at: recorded.at };
  }),
  plainLanguage: {
    task: 'publish an event to the brain',
    attempt: ({ event }) => `publish the event ${quoted(event.type)} to the brain`,
    outcome: (_published, { event }) =>
      `The event ${quoted(event.type)} is published to the brain. Publishing it again with the same source and id records nothing more.`,
  },
});
