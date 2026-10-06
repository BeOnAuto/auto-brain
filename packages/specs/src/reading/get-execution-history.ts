import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  PublicEventSchema,
  defaultPageLimit,
  defineQuery,
  mostRecordsInAPage,
  presentationOf,
  type Presentation,
  type Presenter,
  type PublicEvent,
  type RecordedEvent,
  type RecordedOrder,
} from '@beonauto/operations';
import { Effect, Order, Schema } from 'effect';

import { executionOf } from '../execution/execution-lookup.ts';
import { loadExecution } from '../operations/execution-access.ts';
import { ExecutionIdField } from '../operations/spec-fields.ts';
import { historyFound } from '../plain-language/reading-words.ts';

const description = [
  'Reads what happened in one run of the brain, one page at a time,',
  'oldest first, or newest first when `order` is desc.',
  'Each event carries its `id`, `at`, when it happened by its own clock, its `type`,',
  'a `summary` in plain words, and its `data`, at most 4 KiB as JSON:',
  'execution_started with the definition type, name and version and who started it;',
  'execution_deferred when the work goes on after the call that started it;',
  'execution_succeeded; execution_rejected with the reason, the detail and the first five issues; and execution_failed.',
  'A workflow also shows workflow_input_applied for each input its run took: the kind and key of the input,',
  'how many steps moved, the first five with their outcomes, and the kinds of what the run did next.',
  'Inputs, outputs and records appear as their sizes in bytes; get_execution reads the output and the record.',
  'A run started again with the same id shows each attempt.',
  'Within a page, events are ordered by when each happened.',
  `\`limit\`, 1 to ${mostRecordsInAPage} and ${defaultPageLimit} when left out, is the most events a page looks at,`,
  'and a page also stops after loading 4 MiB of stored data, so it may hold fewer events than `limit`.',
  'Read on with `cursor` set to the `next_cursor` of the page before; `next_cursor` is null when nothing remains.',
  '`execution_id` is the UUID that execute_spec answered with or was given.',
  'Oldest first, the newest events of a run may take a moment to appear, while the ledger still writes:',
  'a page of a run that exists may then be empty with next_cursor null, and a later read shows them.',
  'Rejected with not_found when the brain has no run with that id, as get_execution is,',
  'and with invalid_input at /cursor for a cursor that a read of this brain did not give.',
].join(' ');

const ExecutionHistoryInput = Schema.Struct({
  execution_id: ExecutionIdField,
  order: PagingInputFields.order,
  limit: PagingInputFields.limit,
  cursor: PagingInputFields.cursor,
});

const EventsPage = Schema.Struct({ events: Schema.Array(PublicEventSchema), ...PagingOutputFields });

interface Presented {
  readonly stream: string;
  readonly event: PublicEvent;
}

const byOwnTimeThenStream = Order.combine(
  Order.mapInput(Order.Number, ({ event }: Presented) => Date.parse(event.at)),
  Order.mapInput(Order.String, ({ stream }: Presented) => stream),
);

const inOrder: Readonly<Record<RecordedOrder, Order.Order<Presented>>> = {
  asc: byOwnTimeThenStream,
  desc: Order.flip(byOwnTimeThenStream),
};

function presentedBy({ present }: Presentation): (recorded: RecordedEvent) => readonly Presented[] {
  return (recorded) => {
    const event = present(recorded);
    return event === null ? [] : [{ stream: recorded.stream, event }];
  };
}

function requireExecution(id: string, records: readonly RecordedEvent[]) {
  return records.length > 0 ? Effect.void : loadExecution(id).pipe(Effect.flatMap((state) => executionOf(id, state)));
}

function historyReader(presentation: Presentation) {
  const presented = presentedBy(presentation);
  return Effect.fnUntraced(function* ({
    execution_id: id,
    order = 'asc',
    limit = defaultPageLimit,
    cursor,
  }: typeof ExecutionHistoryInput.Type) {
    const page = yield* (yield* BrainReader).readRecorded(
      { kind: 'run', execution: id },
      { order, limit, ...(cursor === undefined ? {} : { cursor }) },
    );
    yield* requireExecution(id, page.records);
    const events = page.records.flatMap((recorded) => presented(recorded)).toSorted(inOrder[order]);
    return { events: events.map(({ event }) => event), has_more: page.hasMore, next_cursor: page.nextCursor };
  });
}

export function defineGetExecutionHistory(presenters: readonly Presenter[]) {
  return defineQuery('brain', {
    name: 'get_execution_history',
    title: 'Get run history',
    description,
    route: { method: 'GET', path: '/executions/{execution_id}/history' },
    inputSchema: ExecutionHistoryInput,
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
