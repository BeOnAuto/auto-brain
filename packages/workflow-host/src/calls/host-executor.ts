import type { CallResult } from '@beonauto/operations';
import {
  DispatchFailed,
  callKeyText,
  type CallCancelReceipt,
  type CallKey,
  type Executor,
  type RunContext,
  type StartCall,
  type StartReceipt,
} from '@beonauto/workflow-engine';
import { Effect, Semaphore, type Cause } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { background, type Background } from './background.ts';
import {
  answeredRow,
  callStateOf,
  cancelledRow,
  deliveredRow,
  startedRow,
  tombstonedRow,
  unfinishedCalls,
  type UnfinishedCall,
} from './call-rows.ts';

export type Perform = (call: StartCall, run: RunContext) => Effect.Effect<CallResult>;

export type Deliver = (key: CallKey, result: CallResult) => Effect.Effect<unknown, unknown>;

export type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

export interface ExecutorParts {
  readonly database: HostDatabase;
  readonly perform: Perform;
  readonly deliver: Deliver;
  readonly trouble: Trouble;
  readonly mostAtOnce: number;
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

function failedTo(output: 'start_call' | 'cancel_call') {
  return ({ detail }: { readonly detail: string }) => new DispatchFailed({ output, detail });
}

function callsOf({ database, perform, deliver, trouble, mostAtOnce }: ExecutorParts, running: Background): Calls {
  const atOnce = Semaphore.makeUnsafe(mostAtOnce);
  const delivered = (key: string, callKey: CallKey, result: CallResult): Effect.Effect<void> =>
    deliver(callKey, result).pipe(
      Effect.andThen(deliveredRow(database, key)),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        trouble('An answer of a call could not be given to its run', cause),
      ),
    );
  return {
    begin: (key, call, run) => {
      running.run(
        key,
        atOnce.withPermit(perform(call, run)).pipe(
          Effect.flatMap((result) =>
            Effect.flatMap(answeredRow(database, key, result), (answered) =>
              answered ? delivered(key, call.key, result) : Effect.void,
            ),
          ),
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

function started(
  database: HostDatabase,
  calls: Calls,
  call: StartCall,
  run: RunContext,
): Effect.Effect<StartReceipt, DatabaseFailed> {
  return Effect.gen(function* () {
    const key = callKeyText(call.key);
    if (yield* startedRow(database, key, call, run)) {
      calls.begin(key, call, run);
      return 'started';
    }
    const { state, result } = yield* callStateOf(database, key);
    if (state === 'cancelled') {
      return 'refused_after_cancel';
    }
    if (result !== null) {
      calls.answerAgain(key, call.key, result);
      return 'answered_again';
    }
    if (calls.isRunning(key)) {
      return 'running';
    }
    calls.begin(key, call, run);
    return 'started_again';
  });
}

function cancelled(
  database: HostDatabase,
  calls: Calls,
  key: string,
  runId: string,
): Effect.Effect<CallCancelReceipt, DatabaseFailed> {
  return Effect.gen(function* () {
    if (yield* cancelledRow(database, key)) {
      yield* calls.interrupt(key);
      return 'cancelled';
    }
    if (yield* tombstonedRow(database, key, runId)) {
      return 'tombstoned';
    }
    const { state } = yield* callStateOf(database, key);
    return state === 'answered' ? 'already_answered' : 'tombstoned';
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
      start: (call, run) => started(database, calls, call, run).pipe(Effect.mapError(failedTo('start_call'))),
      cancel: (call, run) =>
        cancelled(database, calls, callKeyText(call.key), run.executionId).pipe(
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
