import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  PublicEventSchema,
  defaultPageLimit,
  defineQuery,
  eventsPageOf,
  mostRecordsInAPage,
  presentationOf,
  mostExaminedInAPage,
  type Presentation,
  type Presenter,
  type RecordedSelection,
} from '@beonauto/operations';
import { Effect, Schema, SchemaTransformation } from 'effect';

import { eventsFound } from '../plain-language/feed-words.ts';

function descriptionFor(publicTypes: readonly string[]): string {
  return [
    'Follows what happened in the brain, one page at a time, newest first, or oldest first when `order` is asc:',
    'what its specs and executions recorded, such as specs created, updated and retired, and executions started and how they ended,',
    'with the steps of each workflow run.',
    'Each event carries its `id`, which stays the same on every read, its `cursor`, the place to read on from,',
    'its `causation_id`, the id of the event that directly led to it or null,',
    '`at`, when it happened by its own clock, its `type`, a `summary` in plain words, and its `data`, at most 4 KiB as JSON.',
    `\`type\` keeps the events of one type: ${publicTypes.join(', ')}.`,
    '`execution_id` keeps what one run and every run it started recorded, its whole tree;',
    'a run started by another run belongs to the tree of the run that started the tree, so its own id answers nothing.',
    '`since` keeps what the brain recorded from that time on, by the time it was recorded, in either order,',
    'so an event may show an `at` a little before it.',
    `\`limit\`, 1 to ${mostRecordsInAPage} and ${defaultPageLimit} when left out, is the most events a page answers with,`,
    'step events included, so a page may end inside the events of one input:',
    `a page looks at that many records, or with \`type\` at up to ${mostExaminedInAPage}, and stops after loading 4 MiB of stored data.`,
    'A record no type of event shows is left out, so a page may hold fewer events than `limit`, or none, while `has_more` is true.',
    'Read on with `cursor` set to the `next_cursor` of the page before, or to the `cursor` of an event;',
    '`next_cursor` is null when nothing remains.',
    'The cursor of the newest event read reads what happens after it, oldest first.',
    "The brain's own creation, update and retirement are not among the events: they belong to the org, and get_brain shows them.",
    'A retired brain stays readable.',
    'Rejected with invalid_input at /cursor for a cursor that a read of this brain did not give.',
  ].join(' ');
}

const RunIdField = Schema.String.annotate({
  description:
    'The id of a run that no other run started, a UUID in any case, kept in lowercase: only what it and the runs it started recorded',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function feedInput(publicTypes: readonly string[]) {
  return Schema.Struct({
    cursor: PagingInputFields.cursor,
    since: PagingInputFields.since,
    type: Schema.optionalKey(
      Schema.Literals(publicTypes).annotate({ description: 'Only the events of this type, by its public name' }),
    ),
    execution_id: Schema.optionalKey(RunIdField),
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

function selectionOf(execution: string | undefined): RecordedSelection {
  return execution === undefined ? { kind: 'everything' } : { kind: 'correlated', correlation: execution };
}

function feedReader(presentation: Presentation) {
  return Effect.fnUntraced(function* (input: FeedInput) {
    const { cursor, since, type, execution_id: execution, order = 'desc', limit = defaultPageLimit } = input;
    const paging = { order, limit, ...(cursor === undefined ? {} : { cursor }) };
    const page = yield* (yield* BrainReader).readRecorded(selectionOf(execution), {
      ...paging,
      ...(since === undefined ? {} : { since }),
      ...(type === undefined ? {} : { types: presentation.storedTypesOf(type) }),
    });
    const { events, hasMore, nextCursor } = eventsPageOf(presentation, page, {
      ...paging,
      ...(type === undefined ? {} : { keeps: (event) => event.type === type }),
    });
    return { events: events.map(({ event }) => event), has_more: hasMore, next_cursor: nextCursor };
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
