import {
  makeDispatcher,
  type BrainRegistry,
  type BrainRequest,
  type CallerIdentity,
  type DispatcherServices,
  type Ledger,
  type OrgRequest,
  type Outcome,
  type Registration,
} from '@beonauto/operations';
import { memoryBrainRegistry, memoryLedger, recordingReporter, type MemoryLedger } from '@beonauto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

export const firstMoment = '2026-10-01T09:00:00.000Z';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

interface BrainOperation {
  readonly registration: Registration<'brain'>;
}

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly dispatch: (
    operation: OrgOperation,
    request: OrgRequest,
  ) => Effect.Effect<Outcome, never, DispatcherServices>;
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>, at?: string) => Promise<A>;
  readonly call: (operation: OrgOperation, request: OrgRequest, at?: string) => Promise<Outcome>;
  readonly callInBrain: (operation: BrainOperation, request: BrainRequest, at?: string) => Promise<Outcome>;
}

export function harness(brainRegistry: Layer.Layer<BrainRegistry, never, Ledger> = memoryBrainRegistry([])): Harness {
  const ledger = memoryLedger();
  const services = Layer.mergeAll(
    ledger.layer,
    Layer.provide(brainRegistry, ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const dispatcher = makeDispatcher([]);
  const dispatch: Harness['dispatch'] = (operation, request) =>
    dispatcher.dispatchToOrg(operation.registration, request);
  const run: Harness['run'] = (calls, at = firstMoment) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(calls),
        Effect.provide(services),
      ),
    );
  return {
    ledger,
    dispatch,
    run,
    call: (operation, request, at) => run(dispatch(operation, request), at),
    callInBrain: (operation, request, at) => run(dispatcher.dispatchToBrain(operation.registration, request), at),
  };
}

export function toOrg(org: string): (caller: CallerIdentity, input?: unknown) => OrgRequest {
  return (caller, input = {}) => ({ caller, org, input, encoding: 'json' });
}

export function toBrain(org: string, brain: string): (caller: CallerIdentity, input?: unknown) => BrainRequest {
  return (caller, input = {}) => ({ caller, org, brain, input, encoding: 'json' });
}

export function asQueryString<Request extends OrgRequest | BrainRequest>(request: Request): Request {
  return { ...request, encoding: 'strings' };
}
