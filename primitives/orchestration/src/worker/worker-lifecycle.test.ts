import { setImmediate } from 'node:timers/promises';

import { Effect, Exit, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { failureRecorder } from '../testing/failure-recorder.ts';
import { fakeTemporalWorkers, type FakeTemporalWorkers } from '../testing/fake-temporal-workers.ts';
import { runOrchestrationWorker } from './orchestration-worker.ts';

const settings = { address: '127.0.0.1:7233', namespace: 'tenants', taskQueue: 'brains', tls: false };

const notCalled = () => Effect.die(new Error('not called'));

async function startedWith(fake: FakeTemporalWorkers) {
  const recorder = failureRecorder();
  const scope = Effect.runSync(Scope.make());
  const exit = await Effect.runPromise(
    Effect.exit(
      runOrchestrationWorker({
        settings,
        executeSpec: notCalled,
        settle: notCalled,
        onFailure: recorder.onFailure,
        reportUnsettled: recorder.reportUnsettled,
        temporal: fake.temporal,
      }).pipe(Scope.provide(scope)),
    ),
  );
  return { exit, failures: recorder.failures, stop: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}

describe('the connection of the orchestration worker', () => {
  it('is closed when the worker cannot be made', async () => {
    const fake = fakeTemporalWorkers({ creation: 'no worker' });
    const { exit } = await startedWith(fake);

    expect(exit).toMatchObject({ _tag: 'Failure' });
    expect(fake.events()).toStrictEqual(['close']);
  });

  it('is closed after the worker shuts down when the worker stops', async () => {
    const fake = fakeTemporalWorkers();
    const { stop } = await startedWith(fake);
    await stop();

    expect(fake.events()).toStrictEqual(['shutdown', 'close']);
  });
});

describe('the worker the orchestration worker makes', () => {
  it('polls the task queue of the settings, and gives activities 10 seconds to finish when it stops', async () => {
    const fake = fakeTemporalWorkers();
    const { stop } = await startedWith(fake);
    await stop();

    expect(fake.definitions()).toMatchObject([
      { namespace: 'tenants', taskQueue: 'brains', shutdownGraceTime: '10 seconds' },
    ]);
  });

  it('does not start under a Temporal runtime that shuts workers down on signals the server owns', async () => {
    const fake = fakeTemporalWorkers({ signals: ['SIGINT', 'SIGTERM'] });
    const { exit } = await startedWith(fake);

    expect(exit).toMatchObject({
      _tag: 'Failure',
      cause: {
        reasons: [
          {
            error: {
              detail:
                "The orchestration worker could not start: Error: Temporal's runtime shuts its workers down on SIGINT, SIGTERM; install it with no shutdownSignals, so that the server alone handles signals",
            },
          },
        ],
      },
    });
    expect(fake.events()).toStrictEqual([]);
  });
});

describe('an orchestration worker that stops on its own', () => {
  it('tells the observer once when its run fails, and stopping it later is harmless', async () => {
    const fake = fakeTemporalWorkers();
    const { failures, stop } = await startedWith(fake);
    fake.end('Temporal went away');
    await setImmediate();
    await stop();

    expect(failures()).toStrictEqual(['The orchestration worker stopped: Error: Temporal went away']);
    expect(fake.events()).toStrictEqual(['close']);
  });

  it('tells the observer when its run ends without being asked to stop', async () => {
    const fake = fakeTemporalWorkers();
    const { failures, stop } = await startedWith(fake);
    fake.end();
    await setImmediate();
    await stop();

    expect(failures()).toStrictEqual(['The orchestration worker stopped on its own']);
  });

  it('tells nobody when it stops because it was asked to', async () => {
    const fake = fakeTemporalWorkers();
    const { failures, stop } = await startedWith(fake);
    await stop();
    await setImmediate();

    expect(failures()).toStrictEqual([]);
  });
});
