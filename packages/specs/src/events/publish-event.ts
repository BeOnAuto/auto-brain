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
import { refusingTheBrainsOwnAttributes, reservedEventTypes, reservedSourcePrefixes } from './reserved-attributes.ts';

interface Publication {
  readonly event: CloudEvent;
  readonly filled: readonly FilledAttribute[];
}

const fillable: readonly FilledAttribute[] = ['id', 'time'];

const reservedTypesInWords = [...reservedEventTypes].join(', ');

const reservedSourcesInWords = reservedSourcePrefixes.join(' or ');

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
    'Publishes an event to the brain and returns its id, its time and when the brain recorded it.',
    '`event` is a CloudEvents 1.0 event. `source`, a URI reference such as /ledger/eu, and `type`, such as',
    'com.acme.ledger.month-closed, are required; `specversion` (1.0), `id`, `subject`, `time` in RFC 3339,',
    '`datacontenttype`, `dataschema` and `data`, any JSON value, are optional. Any other attribute is an extension,',
    'named in lowercase letters and digits, with text, a boolean or an integer as its value, and is kept as given.',
    'The brain makes an id when `id` is left out, and takes the time it records the event when `time` is left out;',
    `with them, the event takes at most ${mostPublishedEventBytes} bytes as JSON in UTF-8.`,
    'An event is one per source and id: publishing it again with the same source and id records nothing and answers',
    'the id and time recorded first, so a call can be retried safely with the same id, and a time left out on the retry',
    'changes nothing. A different event under the same source and id is rejected with conflict.',
    `The types ${reservedTypesInWords} and sources under ${reservedSourcesInWords} are the brain's own, for what it`,
    'records itself, and are refused. list_brain_events shows the events published to the brain.',
    'Rejected with invalid_input for an event that breaks these rules.',
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
