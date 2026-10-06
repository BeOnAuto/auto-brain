import {
  makeDispatcher,
  settle,
  type BrainRequest,
  type CallerIdentity,
  type DispatcherServices,
  type Outcome,
  type Settled,
} from '@beonauto/operations';
import {
  memoryBrainRegistry,
  memoryLedger,
  recordingReporter,
  type MemoryLedger,
  type ReportedIncident,
} from '@beonauto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

import { runOutcomeMapping, type BrainOperation } from '../index.ts';

export const firstMoment = '2026-10-01T09:00:00.000Z';

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly reported: () => readonly ReportedIncident[];
  readonly dispatch: (
    operation: BrainOperation,
    request: BrainRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>, at?: string) => Promise<A>;
  readonly call: (operation: BrainOperation, request: BrainRequest, at?: string) => Promise<Outcome>;
  readonly callCancelledWhen: (
    cancelled: Promise<unknown>,
    operation: BrainOperation,
    request: BrainRequest,
  ) => Promise<Settled>;
}

const knownBrains = [
  { org: 'acme', brain: 'alpha' },
  { org: 'acme', brain: 'beta' },
  { org: 'globex', brain: 'gamma' },
];

export function harness(): Harness {
  const ledger = memoryLedger(runOutcomeMapping);
  const recording = recordingReporter();
  const services = Layer.mergeAll(ledger.layer, memoryBrainRegistry(knownBrains), recording.layer, TestClock.layer());
  const dispatcher = makeDispatcher([]);
  const dispatch: Harness['dispatch'] = (operation, request) =>
    dispatcher.dispatchToBrain(operation.registration, request);
  const run: Harness['run'] = (calls, at = firstMoment) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(calls),
        Effect.provide(services),
      ),
    );
  return {
    ledger,
    reported: recording.reported,
    dispatch,
    run,
    call: (operation, request, at) => run(dispatch(operation, request), at),
    callCancelledWhen: (cancelled, operation, request) => {
      const cancelling = new AbortController();
      void cancelled.then(() => {
        cancelling.abort();
        return cancelling;
      });
      return run(settle(dispatch(operation, request), cancelling.signal));
    },
  };
}

export function toBrain(org: string, brain: string): (caller: CallerIdentity, input?: unknown) => BrainRequest {
  return (caller, input = {}) => ({ caller, org, brain, input, encoding: 'json' });
}

export function asQueryString(request: BrainRequest): BrainRequest {
  return { ...request, encoding: 'strings' };
}
