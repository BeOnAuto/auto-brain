import { Runtime } from '@temporalio/worker';
import { Effect, Exit, Scope } from 'effect';
import { describe, expect, inject, it } from 'vitest';

import { failureRecorder } from '../testing/failure-recorder.ts';
import { runOrchestrationWorker } from './orchestration-worker.ts';

const notCalled = () => Effect.die(new Error('not called'));

describe('the orchestration worker in a process with no Temporal runtime yet', () => {
  it("installs Temporal's runtime with no shutdown signals, so that the server alone handles them", async () => {
    const recorder = failureRecorder();
    const scope = Effect.runSync(Scope.make());
    const address = inject('temporalAddress');
    const settings = {
      address,
      namespace: 'default',
      taskQueue: 'runtime',
      tls: false,
      mostDuration: 2_592_000_000,
      nestedExecutions: 32,
    };
    await Effect.runPromise(
      runOrchestrationWorker({
        settings,
        executeSpec: notCalled,
        settle: notCalled,
        onFailure: recorder.onFailure,
        reportUnsettled: recorder.reportUnsettled,
      }).pipe(Scope.provide(scope)),
    );
    const { shutdownSignals } = Runtime.instance().options;
    await Effect.runPromise(Scope.close(scope, Exit.void));

    expect(shutdownSignals).toStrictEqual([]);
    expect(recorder.failures()).toStrictEqual([]);
  }, 120_000);
});
