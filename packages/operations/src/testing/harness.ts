import { Effect, Layer } from 'effect';

import {
  makeDispatcher,
  settle,
  type BrainAddress,
  type BrainRequest,
  type CallerIdentity,
  type Dispatcher,
  type DispatcherServices,
  type IncidentReporter,
  type OrgRequest,
  type Outcome,
  type PipelineStep,
  type RunOutcomeMapping,
  type KeyedProjection,
  type Settled,
} from '../index.ts';
import { memoryBrainRegistry } from './memory-brain-registry.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';
import { recordingReporter, type ReportedIncident } from './recording-reporter.ts';

export interface HarnessOptions {
  readonly steps?: readonly PipelineStep[];
  readonly reporter?: Layer.Layer<IncidentReporter>;
  readonly brains?: readonly BrainAddress[];
  readonly retiredBrains?: readonly BrainAddress[];
  readonly runOutcomes?: RunOutcomeMapping;
  readonly projections?: readonly KeyedProjection[];
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly ledger: MemoryLedger;
  readonly reported: () => readonly ReportedIncident[];
  readonly run: <A>(calls: Effect.Effect<A, never, DispatcherServices>) => Promise<A>;
  readonly settleWithin: (
    milliseconds: number,
    call: Effect.Effect<Outcome, never, DispatcherServices>,
  ) => Promise<Settled>;
}

const knownBrains: readonly BrainAddress[] = [
  { org: 'acme', brain: 'alpha' },
  { org: 'acme', brain: 'beta' },
  { org: 'globex', brain: 'gamma' },
];

export function harness({
  steps = [],
  reporter,
  brains = knownBrains,
  retiredBrains = [],
  runOutcomes,
  projections = [],
}: HarnessOptions = {}): Harness {
  const ledger = memoryLedger(runOutcomes, projections);
  const recording = recordingReporter();
  const services = Layer.mergeAll(
    ledger.layer,
    memoryBrainRegistry(brains, retiredBrains),
    reporter ?? recording.layer,
  );
  const run = <A>(calls: Effect.Effect<A, never, DispatcherServices>) =>
    Effect.runPromise(calls.pipe(Effect.provide(services)));
  return {
    dispatcher: makeDispatcher(steps),
    ledger,
    reported: recording.reported,
    run,
    settleWithin: (milliseconds, call) => run(settle(call, AbortSignal.timeout(milliseconds))),
  };
}

export function toOrg(org: string): (caller: CallerIdentity, input?: unknown) => OrgRequest {
  return (caller, input = {}) => ({ caller, org, input, encoding: 'json' });
}

export function toBrain(org: string, brain: string): (caller: CallerIdentity, input?: unknown) => BrainRequest {
  return (caller, input = {}) => ({ caller, org, brain, input, encoding: 'json' });
}
