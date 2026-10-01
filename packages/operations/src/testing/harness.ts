import { Effect, Layer } from 'effect';

import {
  makeDispatcher,
  settle,
  type BrainRequest,
  type CallerIdentity,
  type Dispatcher,
  type DispatcherServices,
  type IncidentReporter,
  type OrgRequest,
  type Outcome,
  type PipelineStep,
  type Settled,
} from '../index.ts';
import { memoryBrainDirectory } from './memory-brain-directory.ts';
import { memoryLedger, type MemoryLedger } from './memory-ledger.ts';
import { recordingReporter, type ReportedIncident } from './recording-reporter.ts';

export interface HarnessOptions {
  readonly steps?: readonly PipelineStep[];
  readonly reporter?: Layer.Layer<IncidentReporter>;
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

const knownBrains = [
  { org: 'acme', brain: 'alpha' },
  { org: 'acme', brain: 'beta' },
  { org: 'globex', brain: 'gamma' },
];

export function harness({ steps = [], reporter }: HarnessOptions = {}): Harness {
  const ledger = memoryLedger();
  const recording = recordingReporter();
  const services = Layer.mergeAll(ledger.layer, memoryBrainDirectory(knownBrains), reporter ?? recording.layer);
  return {
    dispatcher: makeDispatcher(steps),
    ledger,
    reported: recording.reported,
    run: (calls) => Effect.runPromise(calls.pipe(Effect.provide(services))),
    settleWithin: async (milliseconds, call) =>
      settle(
        await Effect.runPromiseExit(call.pipe(Effect.provide(services)), { signal: AbortSignal.timeout(milliseconds) }),
      ),
  };
}

export function toOrg(org: string): (caller: CallerIdentity, input?: unknown) => OrgRequest {
  return (caller, input = {}) => ({ caller, org, input, form: 'json' });
}

export function toBrain(org: string, brain: string): (caller: CallerIdentity, input?: unknown) => BrainRequest {
  return (caller, input = {}) => ({ caller, org, brain, input, form: 'json' });
}
