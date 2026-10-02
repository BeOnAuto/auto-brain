import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { afterAll, describe, expect, inject, it } from 'vitest';

import { temporaryLedger } from './testing/temporary-ledger.ts';
import { freePort, requestTo, settledOver, untilLogged, workflowProcess } from './testing/workflow-process.ts';
import { executionIdIn, workflowSource, workflowTestTimeoutMs } from './testing/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

describe('a server that ran workflows, told to stop', { timeout: workflowTestTimeoutMs }, () => {
  it('exits 0 at once, holding nothing open: its Temporal client is closed and no deadline of a request is waited for', async () => {
    const child = workflowProcess(ledger.fileName, inject('temporalAddress'), `server-${randomUUID()}`);
    const port = await child.port;
    await untilLogged(child, (message) => message === 'The workflow worker started');
    await requestTo(port, 'POST', '', { brain: 'alpha', name: 'Alpha' });
    await requestTo(port, 'POST', '/alpha/specs/orchestration', { name: 'greeting', source: greeting });
    const started = await requestTo(port, 'POST', '/alpha/specs/orchestration/greeting/execute', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(port, `/alpha/executions/${executionIdIn(started.body)}`);

    const stopping = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(settled).toMatchObject({ status: 'succeeded' });
    expect(exitCode).toBe(0);
    expect(child.output().stderr).not.toContain('was still running');
    expect(performance.now() - stopping).toBeLessThan(3000);
  });

  it('exits 1 at a second signal while a request still waits for a Temporal that does not answer', async () => {
    const child = workflowProcess(ledger.fileName, `127.0.0.1:${await freePort()}`, `server-${randomUUID()}`);
    const port = await child.port;
    await requestTo(port, 'POST', '', { brain: 'beta', name: 'Beta' });
    await requestTo(port, 'POST', '/beta/specs/orchestration', { name: 'greeting', source: greeting });
    const waiting = requestTo(port, 'POST', '/beta/specs/orchestration/greeting/execute', { input: {} }).then(
      () => 'answered',
      () => 'cut off',
    );
    await setTimeout(500);

    child.signal('SIGTERM');
    await setTimeout(500);
    const insisting = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(exitCode).toBe(1);
    expect(performance.now() - insisting).toBeLessThan(2000);
    expect(child.output().stderr).toContain(
      'auto-brain was told to stop again, so it exits now without finishing its shutdown',
    );
    expect(await waiting).toBe('cut off');
  });
});
