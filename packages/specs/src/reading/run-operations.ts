import type { Presenter } from '@beonauto/operations';

import { defineGetBrainAnalytics } from '../analytics/get-brain-analytics.ts';
import { defineCancelExecution } from '../cancellation/cancel-execution.ts';
import { defineGetExecution } from '../operations/get-execution.ts';
import { makeSpecPresenters } from '../presenting/spec-presenters.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { defineGetExecutionHistory } from './get-execution-history.ts';
import { defineListExecutions } from './list-executions.ts';

export function runOperations(
  primitives: readonly Primitive[],
  presenters: readonly Presenter[] = makeSpecPresenters(primitives),
) {
  return [
    defineGetExecution(primitives),
    defineCancelExecution(primitives),
    defineListExecutions(primitives),
    defineGetExecutionHistory(presenters),
    defineGetBrainAnalytics(primitives),
  ];
}
