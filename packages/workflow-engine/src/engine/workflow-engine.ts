import type { Conflict } from '@beonauto/operations';
import type { Effect } from 'effect';

import type { DispatchWatermark } from '../dispatch/dispatch-watermark.ts';
import type { Executor } from '../executor/executor.ts';
import type { SubmissionOutcome } from '../machine/admission.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunStore } from '../run-log/run-store.ts';
import type { RunSerialiser } from '../serialisation/run-serialiser.ts';
import type { RecordStore } from '../settlement/record-store.ts';
import type { Timers } from '../timers/timers.ts';

export interface EnginePorts {
  readonly runStore: RunStore;
  readonly watermark: DispatchWatermark;
  readonly timers: Timers;
  readonly executor: Executor;
  readonly recordStore: RecordStore;
  readonly serialiser: RunSerialiser;
}

export interface Submission {
  readonly outcome: SubmissionOutcome;
  readonly version: number;
}

export interface Wake {
  readonly version: number;
  readonly dispatchedThrough: number;
}

export interface SweepReport {
  readonly runs: number;
  readonly behind: number;
  readonly timersArmedAgain: number;
}

export interface WorkflowEngine {
  readonly submit: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly wake: (executionId: string) => Effect.Effect<Wake>;
  readonly sweep: () => Effect.Effect<SweepReport>;
}
