import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  PublicEventSchema,
  defaultPageLimit,
  defineQuery,
  eventsPageOf,
  presentationOf,
  type Presentation,
  type Presenter,
  type RecordedSelection,
} from '@beonauto/operations';
import { Effect, Schema, SchemaTransformation } from 'effect';

import { eventsFound } from '../plain-language/feed-words.ts';

const description = [
  'Lists what happened in the brain a page at a time, newest first: definitions saved and retired, runs started and how they ended,',
  'the steps of workflow runs, tool calls, and the events published to it, each with a summary in plain words.',
  "Use it to follow the brain's activity or to find the events a recall function or a workflow's schedule can take; get_execution_history reads one run alone.",
  '`type` keeps one type of event, `execution_id` one run and every run it started, `since` what was recorded from that time on,',
  'and `cursor` is the next_cursor of the page before.',
  "The brain's own creation, update and retirement are not among the events; get_brain shows them.",
].join(' ');

const RunIdField = Schema.String.annotate({
  description: 'The id of a run that no other run started: only what it and the runs it started recorded',
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
    description,
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
