import { Result } from 'effect';

import { workflowMachine } from '../decider/workflow-machine.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { startedOf, testMachineOf } from '../testing/driver-inputs.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

export function decidedOnce(sandbox: MachineSandbox, source: string, at: number): RunState {
  const document = workflow(source);
  const events = Result.getOrThrow(
    workflowMachine(testMachineOf(sandbox)).decide(startedOf({ runId: drivenRunId, document }, at), newRun),
  );
  return events.reduce((state, event) => evolveRun(state, event), newRun);
}
