import {
  BrainReader,
  PagingInputFields,
  PagingOutputFields,
  defaultPageLimit,
  defineQuery,
  mostRecordsInAPage,
  mostRunsExaminedInAPage,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { ExecutionSchema } from '../execution/execution.ts';
import { SpecNameField } from '../operations/spec-fields.ts';
import { runsListed, runsToList } from '../plain-language/reading-words.ts';
import { specWordsFor } from '../plain-language/spec-words.ts';
import { PrimitiveField, knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { storedTypesByStatus } from './execution-status.ts';
import { ListedExecutionSchema, listedExecutionsOf, type ListedExecution } from './listed-execution.ts';

const description = [
  'Lists the executions of the brain, one page at a time, newest first by when each first started;',
  'an execution started again with the same id keeps the place of its first start.',
  'Each is the execution as get_execution shows it, without its output, its record and the detail and issues of a rejection:',
  'its id, primitive, spec name and version, status, who started it and when, when it finished,',
  'and the reason of a rejection with, for unavailable, its kind.',
  '`status` keeps the executions in that status; `primitive` and `name` keep those of that primitive and spec name.',
  `\`limit\`, 1 to ${mostRecordsInAPage} and ${defaultPageLimit} when left out, is the most executions a page answers with.`,
  `A page also stops after loading 4 MiB of stored data, and after looking at ${mostRunsExaminedInAPage} executions for a \`status\`;`,
  '`primitive` and `name` apply to the executions a page looked at,',
  'so a page may hold fewer executions than `limit`, or none, while `has_more` is true.',
  'Read on with `cursor` set to the `next_cursor` of the page before; `next_cursor` is null when nothing remains.',
  'Read one execution in full with get_execution, and what happened in it with get_execution_history.',
  'Rejected with invalid_input at /cursor for a cursor that a read of this brain did not give.',
].join(' ');

const ListExecutionsInput = Schema.Struct({
  primitive: Schema.optionalKey(PrimitiveField),
  name: Schema.optionalKey(SpecNameField.annotate({ description: 'Only the executions of the specs with this name' })),
  status: Schema.optionalKey(
    ExecutionSchema.fields.status.annotate({
      description: 'Only the executions in this status: started, succeeded, rejected or failed',
    }),
  ),
  limit: PagingInputFields.limit,
  cursor: PagingInputFields.cursor,
});

const ListedExecutionsPage = Schema.Struct({
  executions: Schema.Array(ListedExecutionSchema),
  ...PagingOutputFields,
});

interface SpecFilter {
  readonly primitive: string | undefined;
  readonly name: string | undefined;
}

function isOfSpec(execution: ListedExecution, { primitive, name }: SpecFilter): boolean {
  return (
    (primitive === undefined || execution.primitive === primitive) && (name === undefined || execution.name === name)
  );
}

const listExecutions = Effect.fnUntraced(function* ({
  primitive,
  name,
  status,
  limit = defaultPageLimit,
  cursor,
}: typeof ListExecutionsInput.Type) {
  const page = yield* (yield* BrainReader).readRecorded(
    { kind: 'executions' },
    {
      order: 'desc',
      limit,
      ...(cursor === undefined ? {} : { cursor }),
      ...(status === undefined ? {} : { types: storedTypesByStatus[status] }),
    },
  );
  const listed = yield* listedExecutionsOf(page.records);
  return {
    executions: listed.filter((execution) => isOfSpec(execution, { primitive, name })),
    has_more: page.hasMore,
    next_cursor: page.nextCursor,
  };
});

export function defineListExecutions(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  const operation = defineQuery('brain', {
    name: 'list_executions',
    title: 'List executions',
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
  return known.publish(operation, 'Only the executions of the specs of this primitive');
}
