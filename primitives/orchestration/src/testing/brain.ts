import {
  makeDispatcher,
  settle as settleCall,
  type CallerIdentity,
  type Outcome,
  type Registration,
  type Settled,
} from '@beonauto/operations';
import { memoryBrainRegistry, recordingReporter, type MemoryLedger } from '@beonauto/operations/testing';
import {
  defineCreateSpec,
  defineExecuteSpec,
  executionSettler,
  getExecution,
  type Primitive,
  type SettleExecution,
} from '@beonauto/specs';
import { Effect, Layer } from 'effect';

import type { ExecuteSpec } from '../calls/spec-execution.ts';
import { specExecutionResultOf } from '../calls/spec-results.ts';
import { acmeCaller } from './workflows.ts';

interface BrainOperation {
  readonly registration: Registration<'brain'>;
}

export interface Brain {
  readonly createSpec: BrainOperation;
  readonly executeSpec: BrainOperation;
  readonly getExecution: BrainOperation;
  readonly call: (operation: BrainOperation, input: object, caller?: CallerIdentity) => Promise<Outcome>;
  readonly callCancelledWhen: (
    cancelled: Promise<unknown>,
    operation: BrainOperation,
    input: object,
  ) => Promise<Settled>;
  readonly executeNested: ExecuteSpec;
  readonly settle: SettleExecution;
}

export function brainOn(ledger: MemoryLedger, primitives: readonly Primitive[]): Brain {
  const services = Layer.mergeAll(
    ledger.layer,
    memoryBrainRegistry([{ org: 'acme', brain: 'alpha' }]),
    recordingReporter().layer,
  );
  const dispatcher = makeDispatcher([]);
  const createSpec = defineCreateSpec(primitives);
  const executeSpec = defineExecuteSpec(primitives);
  const dispatch = (operation: BrainOperation, input: object, caller: CallerIdentity): Effect.Effect<Outcome> =>
    dispatcher
      .dispatchToBrain(operation.registration, { caller, org: 'acme', brain: 'alpha', input, encoding: 'json' })
      .pipe(Effect.provide(services));
  const call: Brain['call'] = (operation, input, caller = acmeCaller) =>
    Effect.runPromise(dispatch(operation, input, caller));
  return {
    createSpec,
    executeSpec,
    getExecution,
    call,
    callCancelledWhen: (cancelled, operation, input) => {
      const cancelling = new AbortController();
      void cancelled.then(() => {
        cancelling.abort();
        return cancelling;
      });
      return Effect.runPromise(
        settleCall(dispatch(operation, input, acmeCaller), cancelling.signal).pipe(Effect.provide(services)),
      );
    },
    executeNested: ({ caller, primitive, name, input, executionId }) =>
      dispatch(executeSpec, { primitive, name, input, execution_id: executionId }, caller).pipe(
        Effect.map(specExecutionResultOf),
      ),
    settle: executionSettler(ledger.service),
  };
}
