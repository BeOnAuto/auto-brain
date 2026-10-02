import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { executionDetailOf } from '../execution/execution-lookup.ts';
import { ExecutionDetailSchema } from '../execution/execution.ts';
import { runWordsFor } from '../plain-language/run-words.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { loadExecution } from './execution-access.ts';
import { ExecutionIdField } from './spec-fields.ts';

export function defineGetExecution(primitives: readonly Primitive[]) {
  const runWords = runWordsFor(primitives);
  return defineQuery('brain', {
    name: 'get_execution',
    title: 'Get execution',
    description: [
      'Reads one execution of a spec in the brain by its id and returns it:',
      'the spec and the version that ran, who started it and when, and its status.',
      'An execution is started while it runs, while work it started finishes after the call returned,',
      'or when the server stopped before it finished;',
      'then succeeded, with its output; rejected, with the reason, detail and issues of the rejection;',
      'or failed, when the primitive broke down.',
      'It shows the record of what the primitive did when the primitive gave one: of the run that succeeded,',
      'or of the work it started that finishes later. execute_spec answers without the record.',
      '`execution_id` is the UUID that execute_spec answered with or was given.',
      'Rejected with not_found when the brain has no execution with that id.',
    ].join(' '),
    route: { method: 'GET', path: '/executions/{execution_id}' },
    inputSchema: Schema.Struct({ execution_id: ExecutionIdField }),
    outputSchema: ExecutionDetailSchema,
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
