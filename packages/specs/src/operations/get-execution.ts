import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { executionOf } from '../execution/execution-lookup.ts';
import { ExecutionSchema } from '../execution/execution.ts';
import { loadExecution } from './execution-access.ts';
import { ExecutionIdField } from './spec-fields.ts';

export const getExecution = defineQuery('brain', {
  name: 'get_execution',
  title: 'Get execution',
  description: [
    'Reads one execution of a spec in the brain by its id and returns it:',
    'the spec and the version that ran, who started it and when, and its status.',
    'An execution is started while it runs, while work it started finishes after the call returned,',
    'or when the server stopped before it finished;',
    'then succeeded, with its output; rejected, with the reason, detail and issues of the rejection;',
    'or failed, when the primitive broke down.',
    '`execution_id` is the UUID that execute_spec answered with or was given.',
    'Rejected with not_found when the brain has no execution with that id.',
  ].join(' '),
  route: { method: 'GET', path: '/executions/{execution_id}' },
  inputSchema: Schema.Struct({ execution_id: ExecutionIdField }),
  outputSchema: ExecutionSchema,
  reasons: ['not_found'],
  handle: ({ execution_id: id }) => loadExecution(id).pipe(Effect.flatMap((state) => executionOf(id, state))),
});
