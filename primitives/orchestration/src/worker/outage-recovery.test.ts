import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Effect, Exit, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { failureRecorder } from '../testing/failure-recorder.ts';
import { temporalLogsSoFar } from '../testing/temporal-logs.ts';
import { settingsFor } from '../testing/temporal.ts';
import { runOrchestrationWorker } from './orchestration-worker.ts';

const notCalled = () => Effect.die(new Error('not called'));

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  return typeof address === 'object' && address !== null ? address.port : 0;
}

function temporalOn(port: number): Promise<TestWorkflowEnvironment> {
  return TestWorkflowEnvironment.createLocal({
    server: { ip: '127.0.0.1', port, log: { format: 'pretty', level: 'error' } },
  });
}

async function untilLogged(message: string, attempts: number): Promise<boolean> {
  if (temporalLogsSoFar().some((entry) => entry.message === message) || attempts <= 1) {
    return temporalLogsSoFar().some((entry) => entry.message === message);
  }
  await setTimeout(250);
  return untilLogged(message, attempts - 1);
}

function messagesLogged(): readonly string[] {
  return temporalLogsSoFar().map(({ message }) => message);
}

describe('a worker whose Temporal goes away and comes back', () => {
  it('logs that it lost Temporal once, instead of every retry, and that it reached Temporal again', async () => {
    const port = await freePort();
    const first = await temporalOn(port);
    const scope = Effect.runSync(Scope.make());
    const recorder = failureRecorder();
    await Effect.runPromise(
      runOrchestrationWorker({
        settings: { ...settingsFor('outage'), address: `127.0.0.1:${port}` },
        executeSpec: notCalled,
        settle: notCalled,
        onFailure: recorder.onFailure,
        reportUnsettled: recorder.reportUnsettled,
      }).pipe(Scope.provide(scope)),
    );

    await first.teardown();
    const lost = await untilLogged('The workflow worker lost Temporal', 120);
    await setTimeout(3000);
    const second = await temporalOn(port);
    const reached = await untilLogged('The workflow worker reached Temporal again', 120);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await second.teardown();

    expect([lost, reached]).toStrictEqual([true, true]);
    expect(messagesLogged().filter((message) => message === 'The workflow worker lost Temporal')).toHaveLength(1);
    expect(messagesLogged().filter((message) => message.startsWith('Temporal reported: gRPC call'))).toStrictEqual([]);
    expect(recorder.failures()).toStrictEqual([]);
  }, 120_000);
});
