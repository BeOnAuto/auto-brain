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
  'Reads what happened in one execution of the brain, one page at a time,',
  'oldest first, or newest first when `order` is desc.',
  'Each event carries its `id`, `at`, when it happened by its own clock, its `type`,',
  'a `summary` in plain words, and its `data`, at most 4 KiB as JSON:',
  'execution_started with the primitive, the spec name and version and who started it;',
  'execution_deferred when the work goes on after the call that started it;',
  'execution_succeeded; execution_rejected with the reason, the detail and the first five issues; execution_failed;',
  'and, for each tool the run called, tool_call_started with the number of the call, the server and the tool',
  'and the size and SHA-256 digest of its arguments, and tool_call_answered with its outcome',
  '(result, tool_error, server_failure, timed_out or cancelled), the size and digest of the result and how long it took.',
  'A call with a start and no answer was in flight when the run ended, so its outcome is unknown.',
  'A workflow also shows workflow_input_applied for each input its run took: the kind and key of the input,',
  'how many steps moved, the first five with their outcomes, and the kinds of what the run did next.',
  'Inputs, outputs, records, arguments and results appear as their sizes in bytes,',
  'with the arguments and the result cut to 2 KiB only when the operator records their content;',
  'get_execution reads the output and the record.',
  'An execution started again with the same id shows each start.',
  'Within a page, events are ordered by when each happened.',
  `\`limit\`, 1 to ${mostRecordsInAPage} and ${defaultPageLimit} when left out, is the most events a page looks at,`,
  'and a page also stops after loading 4 MiB of stored data, so it may hold fewer events than `limit`.',
  'Read on with `cursor` set to the `next_cursor` of the page before; `next_cursor` is null when nothing remains.',
  '`execution_id` is the UUID that execute_spec answered with or was given.',
  'Oldest first, the newest events of an execution may take a moment to appear, while the ledger still writes:',
  'a page of an execution that exists may then be empty with next_cursor null, and a later read shows them.',
  'Rejected with not_found when the brain has no execution with that id, as get_execution is,',
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
    title: 'Get execution history',
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
