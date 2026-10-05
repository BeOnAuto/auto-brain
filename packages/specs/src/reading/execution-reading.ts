import type { Presenter } from '@beonauto/operations';

import { makeSpecPresenters } from '../presenting/spec-presenters.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { defineGetExecutionHistory } from './get-execution-history.ts';
import { defineListExecutions } from './list-executions.ts';

export function executionReadings(
  primitives: readonly Primitive[],
  presenters: readonly Presenter[] = makeSpecPresenters(primitives),
) {
  return [defineListExecutions(primitives), defineGetExecutionHistory(presenters)];
}
