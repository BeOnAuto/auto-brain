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
  type Presentation,
  type Presenter,
  type RecordedEvent,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { executionOf } from '../execution/execution-lookup.ts';
import { loadExecution } from '../operations/execution-access.ts';
import { ExecutionIdField } from '../operations/spec-fields.ts';
import { historyFound } from '../plain-language/reading-words.ts';

const description = [
  'Reads what happened in one run of the brain, one page at a time,',
  'oldest first, or newest first when `order` is desc.',
  'Each event carries its `id`, which stays the same on every read, its `cursor`, the place to read on from,',
  'its `causation_id`, the id of the event that directly led to it or null,',
  '`at`, when it happened by its own clock, its `type`, a `summary` in plain words, and its `data`, at most 4 KiB as JSON:',
  'execution_started with the definition type, name and version and who started it;',
  'execution_succeeded; execution_rejected with the reason, the detail and the first five issues; execution_failed;',
  'and, for each tool the run called, tool_call_started with the number of the call, the server and the tool',
  'and the size and SHA-256 digest of its arguments, and tool_call_answered with its outcome',
  '(result, tool_error, server_failure, timed_out or cancelled), the size and digest of the result and how long it took.',
  'A call with a start and no answer was in flight when the run ended, so its outcome is unknown.',
  'A workflow also shows workflow_input_applied for each input its run took: the kind and key of the input,',
  'how many steps moved, the first five with their outcomes, and the kinds of what the run did next;',
  'then one event for each step entry of that input: step_started, step_waiting with what it waits for,',
  'step_finished, step_failed with its error, and step_skipped, each with the name, reference, run and times of the step,',
  'and on the step_waiting of a call the execution_id of the run it started, whose events name that step_waiting as their cause.',
  'Inputs, outputs, records, arguments and results appear as their sizes in bytes,',
  'with the arguments and the result cut to 2 KiB only when the operator records their content;',
  'get_execution reads the output and the record.',
  'A run started again with the same id shows each attempt.',
  'Events follow the order the brain recorded them in, so each comes after the event that caused it.',
  `\`limit\`, 1 to ${mostRecordsInAPage} and ${defaultPageLimit} when left out, is the most events a page answers with,`,
  'step events included, so a page may end inside the events of one input;',
  'a page also stops after loading 4 MiB of stored data, so it may hold fewer events than `limit`.',
  'Read on with `cursor` set to the `next_cursor` of the page before, or to the `cursor` of an event;',
  '`next_cursor` is null when nothing remains.',
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

function requireExecution(id: string, records: readonly RecordedEvent[]) {
  return records.length > 0 ? Effect.void : loadExecution(id).pipe(Effect.flatMap((state) => executionOf(id, state)));
}

function historyReader(presentation: Presentation) {
  return Effect.fnUntraced(function* ({
    execution_id: id,
    order = 'asc',
    limit = defaultPageLimit,
    cursor,
  }: typeof ExecutionHistoryInput.Type) {
    const paging = { order, limit, ...(cursor === undefined ? {} : { cursor }) };
    const page = yield* (yield* BrainReader).readRecorded({ kind: 'run', execution: id }, paging);
    yield* requireExecution(id, page.records);
    const { events, hasMore, nextCursor } = eventsPageOf(presentation, page, paging);
    return {
      events: events.map(({ event }) => event),
      has_more: hasMore,
      next_cursor: nextCursor,
    };
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
