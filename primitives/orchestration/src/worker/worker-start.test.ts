import { Effect, Exit, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { failureRecorder } from '../testing/failure-recorder.ts';
import { settingsFor } from '../testing/temporal.ts';
import { runOrchestrationWorker } from './orchestration-worker.ts';
import type { TemporalSettings } from './temporal-settings.ts';

const notCalled = () => Effect.die(new Error('not called'));

function workerWith(settings: TemporalSettings) {
  return runOrchestrationWorker({
    settings,
    executeSpec: notCalled,
    settle: notCalled,
    onFailure: failureRecorder().onFailure,
  });
}

async function failureOf(settings: TemporalSettings): Promise<string> {
  const failure = await Effect.runPromise(Effect.scoped(Effect.flip(workerWith(settings))));
  return failure.detail;
}

describe('starting the orchestration worker', () => {
  it('fails when Temporal cannot be reached', async () => {
    expect(await failureOf({ ...settingsFor('unreachable'), address: '127.0.0.1:1' })).toMatch(
      /^The orchestration worker could not start: TransportError: /u,
    );
  });

  it('fails, closing its connection, when the worker cannot be made', async () => {
    expect(await failureOf({ ...settingsFor(''), taskQueue: '' })).toMatch(
      /^The orchestration worker could not start: /u,
    );
  });

  it('starts and stops cleanly', async () => {
    const scope = Effect.runSync(Scope.make());

    expect(
      await Effect.runPromise(Effect.exit(workerWith(settingsFor('starting')).pipe(Scope.provide(scope)))),
    ).toEqual(Exit.void);
    expect(await Effect.runPromise(Effect.exit(Scope.close(scope, Exit.void)))).toEqual(Exit.void);
  }, 60_000);
});
