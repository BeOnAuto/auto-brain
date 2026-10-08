import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  defaultPageLimit,
  defineQuery,
  mostExaminedInAPage,
  type RecordedSelection,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { RunSchema } from '../execution/execution.ts';
import { RunsOfNameField } from '../operations/spec-fields.ts';
import { runsListed, runsToList } from '../plain-language/reading-words.ts';
import { specWordsFor } from '../plain-language/spec-words.ts';
import { PrimitiveField, knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { storedTypesByStatus } from './execution-status.ts';
import { ListedRunSchema, listedExecutionsOf } from './listed-execution.ts';

const description = [
  'Lists the runs of the brain a page at a time, newest first, each with its definition, its status, who started it and when it ended, without its output.',
  'Use it to find a run the person means, such as the runs of a scheduled workflow; get_execution reads one run in full.',
  '`primitive` and `name` keep the runs of one definition and `status` those in one status.',
  `A filtered page looks at up to ${mostExaminedInAPage} runs, so it may hold fewer runs than \`limit\`, or none, while has_more is true.`,
  '`cursor` is the next_cursor of the page before.',
].join(' ');

const ListExecutionsInput = Schema.Struct({
  primitive: Schema.optionalKey(PrimitiveField),
  name: Schema.optionalKey(RunsOfNameField),
  status: Schema.optionalKey(
    RunSchema.fields.status.annotate({
      description: 'Only runs in this status: started, succeeded, rejected or failed',
    }),
  ),
  limit: PagingInputFields.limit,
  cursor: PagingInputFields.cursor,
});

const ListedExecutionsPage = Schema.Struct({
  executions: Schema.Array(ListedRunSchema),
  ...PagingOutputFields,
});

function streamsOfRuns(primitive: string | undefined, name: string | undefined): RecordedSelection {
  return {
    kind: 'executions',
    notBeginningWith: ['execution_cancel_requested'],
    ...(primitive === undefined ? {} : { primitive }),
    ...(name === undefined ? {} : { name }),
  };
}

const listExecutions = Effect.fnUntraced(function* ({
  primitive,
  name,
  status,
  limit = defaultPageLimit,
  cursor,
}: typeof ListExecutionsInput.Type) {
  const page = yield* (yield* BrainReader).readRecorded(streamsOfRuns(primitive, name), {
    order: 'desc',
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(status === undefined ? {} : { types: storedTypesByStatus[status] }),
  });
  return {
    executions: yield* listedExecutionsOf(page.records),
    has_more: page.hasMore,
    next_cursor: page.nextCursor,
  };
});

export function defineListExecutions(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  const operation = defineQuery('brain', {
    name: 'list_executions',
    title: 'List runs',
    description,
    route: { method: 'GET', path: '/executions' },
    inputSchema: ListExecutionsInput,
    outputSchema: ListedExecutionsPage,
    reasons: ['invalid_input'],
    handle: listExecutions,
    plainLanguage: {
      task: 'list the runs',
      attempt: (filters) => runsToList(words, filters),
      outcome: (page, filters) => runsListed(words, page, filters),
    },
  });
  return known.publish(operation, 'Only the runs of this type');
}
