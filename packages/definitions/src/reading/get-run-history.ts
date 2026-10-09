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
  type RecordedEvent,
  type RecordedPageRequest,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { RunIdInputField } from '../operations/definition-fields.ts';
import { historyFound } from '../plain-language/reading-words.ts';
import { noRunCalled } from '../runs/run-lookup.ts';

const description = [
  'Reads what happened in one run, a page at a time, oldest first: when it started and ended,',
  'each tool call a reasoning function made with its outcome, and each step of a workflow with what it waited for and the runs it started.',
  'Inputs, outputs and results appear as their sizes; get_run reads the output and the record.',
  'Use it to see what a run did, such as which tools it called before it did not succeed.',
  "`run_id` is the run's id, `order` reads newest first when desc, and `cursor` is the next_cursor of the page before.",
].join(' ');

const RunHistoryInput = Schema.Struct({
  run_id: RunIdInputField,
  order: PagingInputFields.order,
  limit: PagingInputFields.limit,
  cursor: PagingInputFields.cursor,
});

const EventsPage = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...PagingOutputFields });

const cancelRequested = 'run_cancel_requested';

const newestHeadAlone: RecordedPageRequest = { order: 'desc', limit: 1, dataOf: [] };

function isACancel({ type }: RecordedEvent): boolean {
  return type === cancelRequested;
}

function isACancelAlone({ type, version }: RecordedEvent): boolean {
  return type === cancelRequested && version === 1;
}

function holdsNoRun(heads: readonly RecordedEvent[]): boolean {
  const [newest] = heads;
  return newest === undefined || isACancelAlone(newest);
}

function newestHeadOf(id: string) {
  return Effect.gen(function* () {
    const { records } = yield* (yield* BrainReader).readRecorded({ kind: 'run', run: id }, newestHeadAlone);
    return records;
  });
}

function historyReader(presentation: Presentation) {
  return Effect.fnUntraced(function* ({
    run_id: id,
    order = 'asc',
    limit = defaultPageLimit,
    cursor,
  }: typeof RunHistoryInput.Type) {
    const paging = { order, limit, ...(cursor === undefined ? {} : { cursor }) };
    const page = yield* (yield* BrainReader).readRecorded({ kind: 'run', run: id }, paging);
    if (page.records.every((record) => isACancel(record)) && holdsNoRun(yield* newestHeadOf(id))) {
      return yield* Effect.fail(noRunCalled(id));
    }
    const { events, hasMore, nextCursor } = eventsPageOf(presentation, page, paging);
    return {
      events: events.map(({ event }) => event),
      has_more: hasMore,
      next_cursor: nextCursor,
    };
  });
}

export function defineGetRunHistory(presenters: readonly Presenter[]) {
  return defineQuery('brain', {
    name: 'get_run_history',
    title: 'Get run history',
    description,
    route: { method: 'GET', path: '/runs/{run_id}/history' },
    inputSchema: RunHistoryInput,
    outputSchema: EventsPage,
    reasons: ['not_found', 'invalid_input'],
    handle: historyReader(presentationOf(presenters)),
    plainLanguage: {
      task: 'read the history of a run',
      attempt: () => 'read the history of the run',
      outcome: historyFound,
    },
  });
}
