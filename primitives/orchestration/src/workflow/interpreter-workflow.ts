import type { Json } from '../dsl/json.ts';
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
    throw api.ApplicationFailure.create({ type: ending.type, message: ending.message, nonRetryable: true });
  };
}
