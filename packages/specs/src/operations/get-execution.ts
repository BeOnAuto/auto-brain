import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { executionDetailOf } from '../execution/execution-lookup.ts';
import { RunDetailSchema } from '../execution/execution.ts';
import { runWordsFor } from '../plain-language/run-words.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { loadExecution } from './execution-access.ts';
import { ExecutionIdField } from './spec-fields.ts';

export function defineGetExecution(primitives: readonly Primitive[]) {
  const runWords = runWordsFor(primitives);
  return defineQuery('brain', {
    name: 'get_execution',
    title: 'Get run',
    description: [
      'Reads one run of the brain by its id: the definition and version that ran, who started it and when, its status,',
      'and its output or why it did not succeed, with the record its type keeps, such as the prompt and tokens of a reasoning function.',
      'A run is started until it ends as succeeded, rejected or failed.',
      'Use it to tell the person how a run ended; get_execution_history shows each step and tool call of the run.',
      '`execution_id` is the id execute_spec answered with or was given.',
    ].join(' '),
    route: { method: 'GET', path: '/executions/{execution_id}' },
    inputSchema: Schema.Struct({ execution_id: ExecutionIdField }),
    outputSchema: RunDetailSchema,
    reasons: ['not_found'],
    handle: ({ execution_id: id }) => loadExecution(id).pipe(Effect.flatMap((state) => executionDetailOf(id, state))),
    plainLanguage: {
      task: 'look up a run',
      attempt: () => 'look up the run',
      outcome: (execution) => runWords(execution, 'looked up'),
    },
  });
}

export const getExecution = defineGetExecution([]);
