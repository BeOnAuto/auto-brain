import {
  Ledger,
  makeDispatcher,
  settle,
  type BrainRequest,
  type CallerIdentity,
  type DispatcherServices,
  type Outcome,
  type RecordedPageRequest,
  type RecordedSelection,
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

export type LedgerRead =
  | { readonly loaded: string }
  | { readonly selection: RecordedSelection; readonly page: RecordedPageRequest };

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly ledgerReads: () => readonly LedgerRead[];
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

function readsRecordedIn(ledger: Ledger['Service'], recorded: (read: LedgerRead) => void): Ledger['Service'] {
  return Ledger.of({
    ...ledger,
    load: (stream, decider) =>
      Effect.suspend(() => {
        recorded({ loaded: stream });
        return ledger.load(stream, decider);
      }),
    readRecorded: (brain, selection, page) =>
      Effect.suspend(() => {
        recorded({ selection, page });
        return ledger.readRecorded(brain, selection, page);
      }),
  });
}

export function harness(): Harness {
  const ledger = memoryLedger(runOutcomeMapping);
  const reads: LedgerRead[] = [];
  const recording = recordingReporter();
  const services = Layer.mergeAll(
    Layer.succeed(
      Ledger,
      readsRecordedIn(ledger.service, (read) => {
        reads.push(read);
      }),
    ),
    memoryBrainRegistry(knownBrains),
    recording.layer,
    TestClock.layer(),
  );
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
    ledgerReads: () => reads,
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
