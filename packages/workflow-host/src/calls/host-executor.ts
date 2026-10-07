import type { CallResult } from '@beonauto/operations';
import {
  DispatchFailed,
  callKeyText,
  type CallKey,
  type Executor,
  type RunContext,
  type StartCall,
  type StartReceipt,
} from '@beonauto/workflow-engine';
import { Effect, Schedule, Semaphore, type Cause } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { correlationOfRun } from '../runs/run-lineage.ts';
import { background, type Background } from './background.ts';
import { cancelledCall, type CancelChild } from './call-cancels.ts';
import {
  answeredRow,
  deliveredRow,
  existingRowOf,
  openCallsUnder,
  refusedRow,
  startedRow,
  unfinishedCalls,
  waitingRow,
  type CallRow,
  type UnfinishedCall,
} from './call-rows.ts';

interface Waiting {
  readonly status: 'waiting';
  readonly child: string;
}

export type CallAnswer = CallResult | Waiting;

export type Perform = (call: StartCall, run: RunContext) => Effect.Effect<CallAnswer>;

export type Deliver = (key: CallKey, result: CallResult) => Effect.Effect<unknown, unknown>;

export type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

export interface ExecutorParts {
  readonly database: HostDatabase;
  readonly perform: Perform;
  readonly deliver: Deliver;
  readonly trouble: Trouble;
  readonly mostAtOnce: number;
  readonly mostOpen: number;
  readonly childOf: (call: StartCall, run: RunContext) => string | null;
  readonly childAnswerOf: (runId: string, child: string) => Effect.Effect<CallResult | undefined>;
  readonly cancelChild: CancelChild;
}

export interface HostExecutor {
  readonly executor: Executor;
  readonly resume: () => Effect.Effect<number>;
  readonly idle: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

interface Calls {
  readonly begin: (key: string, call: StartCall, run: RunContext) => void;
  readonly answerAgain: (key: string, callKey: CallKey, result: CallResult) => void;
  readonly isRunning: (key: string) => boolean;
  readonly interrupt: (key: string) => Effect.Effect<void>;
}

const answerWrittenAgain = Schedule.min([Schedule.exponential('50 millis'), Schedule.spaced('30 seconds')]);

function writtenUntilItIs<A>(
  written: Effect.Effect<A, DatabaseFailed>,
  trouble: Trouble,
): Effect.Effect<A, DatabaseFailed> {
  const failures = { reported: false };
  return written.pipe(
    Effect.tapCause((cause: Cause.Cause<unknown>) => {
      if (failures.reported) {
        return Effect.void;
      }
      failures.reported = true;
      return trouble('An answer of a call could not be recorded; it is written again until it is', cause);
    }),
    Effect.retry(answerWrittenAgain),
  );
}

function failedTo(output: 'start_call' | 'cancel_call') {
  return ({ detail }: { readonly detail: string }) => new DispatchFailed({ output, detail });
}

function tooManyOpen(mostOpen: number): CallResult {
  return {
    status: 'rejected',
    reason: 'conflict',
    detail: `The runs under the run at the top of this tree already wait for ${mostOpen} calls, the most one tree of runs may have open, so this call was not started`,
  };
}

function callsOf(parts: ExecutorParts, running: Background): Calls {
  const { database, perform, deliver, trouble, mostAtOnce } = parts;
  const atOnce = Semaphore.makeUnsafe(mostAtOnce);
  const delivered = (key: string, callKey: CallKey, result: CallResult): Effect.Effect<void> =>
    deliver(callKey, result).pipe(
      Effect.andThen(deliveredRow(database, key)),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        trouble('An answer of a call could not be given to its run', cause),
      ),
    );
  const settled = (key: string, call: StartCall, result: CallResult): Effect.Effect<void, DatabaseFailed> =>
    Effect.flatMap(writtenUntilItIs(answeredRow(database, key, result), trouble), (written) =>
      written ? delivered(key, call.key, result) : Effect.void,
    );
  const waited = (key: string, call: StartCall, child: string): Effect.Effect<void, DatabaseFailed> =>
    writtenUntilItIs(waitingRow(database, key, child), trouble).pipe(
      Effect.andThen(parts.childAnswerOf(call.key.executionId, child)),
      Effect.flatMap((ended) => (ended === undefined ? Effect.void : settled(key, call, ended))),
    );
  const answered = (key: string, call: StartCall, answer: CallAnswer): Effect.Effect<void, DatabaseFailed> =>
    answer.status === 'waiting' ? waited(key, call, answer.child) : settled(key, call, answer);
  return {
    begin: (key, call, run) => {
      running.run(
        key,
        atOnce.withPermit(perform(call, run)).pipe(
          Effect.flatMap((answer) => answered(key, call, answer)),
          Effect.catchCause((cause: Cause.Cause<unknown>) => trouble('A call could not record its answer', cause)),
        ),
      );
    },
    answerAgain: (key, callKey, result) => {
      running.run(key, delivered(key, callKey, result));
    },
    isRunning: running.has,
    interrupt: running.interrupt,
  };
}

function startedOnce(
  { database, mostOpen, childOf }: ExecutorParts,
  calls: Calls,
  call: StartCall,
  run: RunContext,
): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.gen(function* () {
    const key = callKeyText(call.key);
    const root = correlationOfRun(run.executionId, run.attributes);
    if ((yield* openCallsUnder(database, root)) >= mostOpen) {
      const refusal = tooManyOpen(mostOpen);
      const refused = yield* refusedRow(database, key, run, refusal);
      if (refused) {
        calls.answerAgain(key, call.key, refusal);
      }
      return refused;
    }
    const inserted = yield* startedRow(database, key, { call, run, child: childOf(call, run), root });
    if (inserted) {
      calls.begin(key, call, run);
    }
    return inserted;
  });
}

function startedAgain(calls: Calls, call: StartCall, run: RunContext, { state, result }: CallRow): StartReceipt {
  const key = callKeyText(call.key);
  if (state === 'cancelled') {
    return 'refused_after_cancel';
  }
  if (state === 'answered' && result !== null) {
    calls.answerAgain(key, call.key, result);
    return 'answered_again';
  }
  if (state === 'waiting' || calls.isRunning(key)) {
    return 'running';
  }
  calls.begin(key, call, run);
  return 'started_again';
}

function started(
  parts: ExecutorParts,
  calls: Calls,
  call: StartCall,
  run: RunContext,
): Effect.Effect<StartReceipt, DatabaseFailed> {
  return Effect.gen(function* () {
    if (yield* startedOnce(parts, calls, call, run)) {
      return 'started';
    }
    return startedAgain(calls, call, run, yield* existingRowOf(parts.database, callKeyText(call.key)));
  });
}

function resumedIn(calls: Calls, { key, call, run, result }: UnfinishedCall): void {
  if (result === null) {
    calls.begin(key, call, run);
  } else {
    calls.answerAgain(key, call.key, result);
  }
}

export function hostExecutor(parts: ExecutorParts): HostExecutor {
  const { database } = parts;
  const running = background();
  const calls = callsOf(parts, running);
  return {
    executor: {
      start: (call, run) => started(parts, calls, call, run).pipe(Effect.mapError(failedTo('start_call'))),
      cancel: (call, run, origin) =>
        cancelledCall({ ...parts, interrupt: calls.interrupt }, { call, run, origin }).pipe(
          Effect.mapError(failedTo('cancel_call')),
        ),
    },
    resume: () =>
      Effect.orDie(unfinishedCalls(database)).pipe(
        Effect.map((unfinished: readonly UnfinishedCall[]) => unfinished.filter(({ key }) => !running.has(key))),
        Effect.tap((orphaned: readonly UnfinishedCall[]) =>
          Effect.sync(() => {
            for (const call of orphaned) {
              resumedIn(calls, call);
            }
          }),
        ),
        Effect.map((orphaned: readonly UnfinishedCall[]) => orphaned.length),
      ),
    idle: running.idle,
    stop: running.stop,
  };
}
