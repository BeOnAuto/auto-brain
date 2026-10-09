import {
  defineCreateDefinition,
  defineRunDefinition,
  runSettler,
  getRun,
  type Capability,
  type SettleRun,
} from '@beonauto/definitions';
import {
  makeDispatcher,
  settle as settleCall,
  type CallerIdentity,
  type Outcome,
  type Registration,
  type Settled,
} from '@beonauto/operations';
import { memoryBrainRegistry, recordingReporter, type MemoryLedger } from '@beonauto/operations/testing';
import { Effect, Layer } from 'effect';

import { definitionRunResultOf } from '../calls/function-results.ts';
import type { RunDefinition } from '../calls/function-run.ts';
import { acmeCaller } from './workflows.ts';

interface BrainOperation {
  readonly registration: Registration<'brain'>;
}

export interface Brain {
  readonly createDefinition: BrainOperation;
  readonly runDefinition: BrainOperation;
  readonly getRun: BrainOperation;
  readonly call: (operation: BrainOperation, input: object, caller?: CallerIdentity) => Promise<Outcome>;
  readonly callCancelledWhen: (
    cancelled: Promise<unknown>,
    operation: BrainOperation,
    input: object,
  ) => Promise<Settled>;
  readonly executeNested: RunDefinition;
  readonly settle: SettleRun;
}

export function brainOn(ledger: MemoryLedger, capabilities: readonly Capability[]): Brain {
  const services = Layer.mergeAll(
    ledger.layer,
    memoryBrainRegistry([{ org: 'acme', brain: 'alpha' }]),
    recordingReporter().layer,
  );
  const dispatcher = makeDispatcher([]);
  const createDefinition = defineCreateDefinition(capabilities);
  const runDefinition = defineRunDefinition(capabilities);
  const dispatch = (operation: BrainOperation, input: object, caller: CallerIdentity): Effect.Effect<Outcome> =>
    dispatcher
      .dispatchToBrain(operation.registration, { caller, org: 'acme', brain: 'alpha', input, encoding: 'json' })
      .pipe(Effect.provide(services));
  const call: Brain['call'] = (operation, input, caller = acmeCaller) =>
    Effect.runPromise(dispatch(operation, input, caller));
  return {
    createDefinition,
    runDefinition,
    getRun,
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
    executeNested: ({ caller, type, name, input, runId }) =>
      dispatch(runDefinition, { type, name, input, run_id: runId }, caller).pipe(Effect.map(definitionRunResultOf)),
    settle: runSettler(ledger.service),
  };
}
