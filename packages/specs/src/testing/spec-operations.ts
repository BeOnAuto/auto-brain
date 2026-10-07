import type { Presenter } from '@beonauto/operations';

import {
  defineCancelExecution,
  defineCreateSpec,
  defineExecuteSpec,
  defineGetExecutionHistory,
  defineGetSpec,
  defineListExecutions,
  defineListSpecs,
  defineRetireSpec,
  defineUpdateSpec,
  getExecution,
  makeSpecPresenters,
  type Primitive,
} from '../index.ts';

export function specOperationsFor(
  primitives: readonly Primitive[],
  presenters: readonly Presenter[] = makeSpecPresenters(primitives),
) {
  return {
    createSpec: defineCreateSpec(primitives),
    listSpecs: defineListSpecs(primitives),
    getSpec: defineGetSpec(primitives),
    updateSpec: defineUpdateSpec(primitives),
    retireSpec: defineRetireSpec(primitives),
    executeSpec: defineExecuteSpec(primitives),
    getExecution,
    cancelExecution: defineCancelExecution(primitives),
    listExecutions: defineListExecutions(primitives),
    getExecutionHistory: defineGetExecutionHistory(presenters),
  };
}
