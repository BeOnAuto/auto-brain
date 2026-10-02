import { Runtime } from '@temporalio/worker';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { failureRecorder } from '../testing/failure-recorder.ts';
import { runOrchestrationWorker } from './orchestration-worker.ts';

const notCalled = () => Effect.die(new Error('not called'));

describe('the orchestration worker in a process whose Temporal runtime something else made', () => {
  it('does not start, naming the runtime made before it', async () => {
    Runtime.instance();
    const recorder = failureRecorder();
    const settings = {
      address: '127.0.0.1:1',
      namespace: 'default',
      taskQueue: 'foreign',
      tls: false,
      mostDuration: 2_592_000_000,
    };

    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.scoped(
          runOrchestrationWorker({
            settings,
            executeSpec: notCalled,
            settle: notCalled,
            onFailure: recorder.onFailure,
            reportUnsettled: recorder.reportUnsettled,
          }),
        ),
      ),
    );

    expect(failure.detail).toContain('Runtime singleton has already been instantiated');
  });
});
