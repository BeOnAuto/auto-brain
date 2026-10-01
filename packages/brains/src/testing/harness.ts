import {
  makeDispatcher,
  type BrainDirectory,
  type CallerIdentity,
  type DispatcherServices,
  type Ledger,
  type OrgRequest,
  type Outcome,
  type Registration,
} from '@beonauto/operations';
import { memoryBrainDirectory, memoryLedger, recordingReporter, type MemoryLedger } from '@beonauto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

export const firstMoment = '2026-10-01T09:00:00.000Z';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly dispatch: (
    operation: OrgOperation,
    request: OrgRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>, at?: string) => Promise<A>;
  readonly call: (operation: OrgOperation, request: OrgRequest, at?: string) => Promise<Outcome>;
}

export function harness(directory: Layer.Layer<BrainDirectory, never, Ledger> = memoryBrainDirectory([])): Harness {
  const ledger = memoryLedger();
  const services = Layer.mergeAll(
    ledger.layer,
    Layer.provide(directory, ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const dispatcher = makeDispatcher([]);
  const dispatch: Harness['dispatch'] = (operation, request) => dispatcher.inOrg(operation.registration, request);
  const run: Harness['run'] = (calls, at = firstMoment) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(calls),
        Effect.provide(services),
      ),
    );
  return { ledger, dispatch, run, call: (operation, request, at) => run(dispatch(operation, request), at) };
}

export function toOrg(org: string): (caller: CallerIdentity, input?: unknown) => OrgRequest {
  return (caller, input = {}) => ({ caller, org, input, form: 'json' });
}

export function asQueryString(request: OrgRequest): OrgRequest {
  return { ...request, form: 'strings' };
}
