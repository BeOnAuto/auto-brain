import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  PublicEventSchema,
  defaultPageLimit,
  defineQuery,
  mostRecordsInAPage,
  presentationOf,
  mostExaminedInAPage,
  type Presentation,
  type Presenter,
  type PublicEvent,
  type RecordedEvent,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { eventsFound } from '../plain-language/feed-words.ts';

function descriptionFor(publicTypes: readonly string[]): string {
  return [
    'Follows what happened in the brain, one page at a time, newest first, or oldest first when `order` is asc:',
    'what its specs and executions recorded, such as specs created, updated and retired, and executions started and how they ended,',
    'and the events published to it with publish_event, each with its type, source and time and the size of its data.',
    'Each event carries its `id`, `at`, when it happened by its own clock, its `type`,',
    'a `summary` in plain words, and its `data`, at most 4 KiB as JSON.',
    `\`type\` keeps the events of one type: ${publicTypes.join(', ')}.`,
    '`since` keeps what the brain recorded from that time on, by the time it was recorded, in either order,',
    'so an event may show an `at` a little before it.',
    `\`limit\`, 1 to ${mostRecordsInAPage} and ${defaultPageLimit} when left out, is the most events a page answers with:`,
    `a page looks at that many records, or with \`type\` at up to ${mostExaminedInAPage}, and stops after loading 4 MiB of stored data.`,
    'A record no type of event shows is left out, so a page may hold fewer events than `limit`, or none, while `has_more` is true.',
    'Read on with `cursor` set to the `next_cursor` of the page before; `next_cursor` is null when nothing remains.',
    'The id of the newest event read serves as a cursor to read what happens after it, oldest first.',
    "The brain's own creation, update and retirement are not among the events: they belong to the org, and get_brain shows them.",
    'A retired brain stays readable.',
    'Rejected with invalid_input at /cursor for a cursor that a read of this brain did not give.',
  ].join(' ');
}

function feedInput(publicTypes: readonly string[]) {
  return Schema.Struct({
    cursor: PagingInputFields.cursor,
    since: PagingInputFields.since,
    type: Schema.optionalKey(
      Schema.Literals(publicTypes).annotate({ description: 'Only the events of this type, by its public name' }),
    ),
    order: PagingInputFields.order,
    limit: PagingInputFields.limit,
  });
}

type FeedInput = ReturnType<typeof feedInput>['Type'];

const EventsPage = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...PagingOutputFields });

function requireSomePublicType(publicTypes: readonly string[]): void {
  if (publicTypes.length === 0) {
    throw new Error('The events of a brain need a presenter that shows at least one type of event');
  }
}

function shownBy({ present }: Presentation, type: string | undefined) {
  return (recorded: RecordedEvent): readonly PublicEvent[] => {
    const event = present(recorded);
    return event === null || (type !== undefined && event.type !== type) ? [] : [event];
  };
}

function feedReader(presentation: Presentation) {
  return Effect.fnUntraced(function* ({ cursor, since, type, order = 'desc', limit = defaultPageLimit }: FeedInput) {
    const page = yield* (yield* BrainReader).readRecorded(
      { kind: 'everything' },
      {
        order,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(since === undefined ? {} : { since }),
        ...(type === undefined ? {} : { types: presentation.storedTypesOf(type) }),
      },
    );
    const shown = shownBy(presentation, type);
    return {
      events: page.records.flatMap((recorded) => shown(recorded)),
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
    };
  });
}

export function defineListBrainEvents(presenters: readonly Presenter[]) {
  const presentation = presentationOf(presenters);
  requireSomePublicType(presentation.publicTypes);
  return defineQuery('brain', {
    name: 'list_brain_events',
    title: 'List brain events',
    description: descriptionFor(presentation.publicTypes),
    route: { method: 'GET', path: '/events' },
    inputSchema: feedInput(presentation.publicTypes),
    outputSchema: EventsPage,
    reasons: ['invalid_input'],
    handle: feedReader(presentation),
    plainLanguage: {
      task: 'read what happened in the brain',
      attempt: () => 'read what happened in the brain',
      outcome: eventsFound,
    },
  });
}
