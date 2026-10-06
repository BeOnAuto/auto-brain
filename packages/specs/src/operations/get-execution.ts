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
      'Reads one run in the brain by its id and returns it:',
      'the definition and version that ran, who started it and when, and its status.',
      'A run is started while it runs, while work it started finishes after the call returned,',
      'or when the server stopped before it finished;',
      'then succeeded, with its output; rejected, with the reason, detail and issues of the rejection;',
      'or failed, when its runtime adapter broke down.',
      'It shows the record supplied by its runtime adapter: of the run that succeeded,',
      'or of the work it started that finishes later. execute_spec answers without the record.',
      '`execution_id` is the UUID that execute_spec answered with or was given.',
      'Rejected with not_found when the brain has no run with that id.',
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
