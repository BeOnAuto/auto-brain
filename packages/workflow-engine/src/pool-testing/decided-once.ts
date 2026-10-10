import { Result } from 'effect';

import { workflowMachine } from '../decider/workflow-machine.ts';
import type { JsonObject } from '../dsl/json.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { startedOf, testMachineOf } from '../testing/driver-inputs.ts';
import { drivenRunId } from '../testing/run-history.ts';

export function decidedOnce(sandbox: MachineSandbox, document: JsonObject, at: number): RunState {
  const events = Result.getOrThrow(
    workflowMachine(testMachineOf(sandbox)).decide(startedOf({ runId: drivenRunId, document }, at), newRun),
  );
  return events.reduce((state, event) => evolveRun(state, event), newRun);
}
