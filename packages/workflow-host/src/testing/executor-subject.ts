import type { CallResult } from '@beonauto/operations';
import { callKeyText, type CallKey } from '@beonauto/workflow-engine';
import type { ExecutorSubject } from '@beonauto/workflow-engine/testing';
import { Deferred, Effect } from 'effect';

import { hostExecutor, type HostExecutor } from '../calls/host-executor.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { runId } from './probe-subjects.ts';

export function executorSubjectOn(database: HostDatabase): ExecutorSubject {
  const finishers = new Map<string, Deferred.Deferred<CallResult>>();
  const answered: string[] = [];
  const finisherOf = (key: CallKey): Deferred.Deferred<CallResult> => {
    const finisher = finishers.get(callKeyText(key)) ?? Deferred.makeUnsafe<CallResult>();
    finishers.set(callKeyText(key), finisher);
    return finisher;
  };
  const executorNow = (): HostExecutor =>
    hostExecutor({
      database,
      perform: (call) => Deferred.await(finisherOf(call.key)),
      deliver: (key) =>
        Effect.sync(() => {
          answered.push(callKeyText(key));
        }),
      trouble: Effect.logWarning,
      mostAtOnce: 4,
    });
  const host = { current: executorNow() };
  return {
    executor: {
      start: (call, run) => host.current.executor.start(call, run),
      cancel: (call, run) => host.current.executor.cancel(call, run),
    },
    run: { executionId: runId, attributes: {} },
    finish: (call, result) => Deferred.succeed(finisherOf(call.key), result),
    loseHost: () =>
      Effect.andThen(
        host.current.stop(),
        Effect.sync(() => {
          host.current = executorNow();
        }),
      ),
    settle: () =>
      Effect.andThen(
        host.current.idle(),
        Effect.sync(() => answered.splice(0)),
      ),
  };
}
