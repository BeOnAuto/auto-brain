import type { Json } from '@beonauto/workflow-engine/dsl/json';

import { startWorkflow } from '../interpreter/interpreter.ts';
import { eventSignalName } from './activity-contract.ts';
import { temporalHost, type WorkflowApi } from './temporal-host.ts';

export type InterpreterWorkflow = (run: unknown) => Promise<Json>;

export function defineInterpreterWorkflow(api: WorkflowApi): InterpreterWorkflow {
  const eventSignal = api.defineSignal(eventSignalName);
  return async (run) => {
    const start = startWorkflow(run, temporalHost(api));
    api.setHandler(eventSignal, start.deliver);
    const ending = await start.ending;
    if (ending.kind === 'completed') {
      return ending.output;
    }
    if (ending.kind === 'cancelled') {
      throw ending.cause;
    }
    if (ending.kind === 'faulted') {
      api.log.error('The workflow failed for a fault of the runtime', { failureType: ending.type });
    }
    throw api.ApplicationFailure.create({ type: ending.type, message: ending.message, nonRetryable: true });
  };
}
