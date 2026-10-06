import { afterAll, describe, expect, it } from 'vitest';

import { temporaryLedger } from '../testing/temporary-ledger.ts';
import {
  gatewayThatHangsFirst,
  requestTo,
  settledOver,
  welcomingStarted,
  workflowProcess,
} from '../testing/workflow-process.ts';
import { executionIdIn, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

describe('a server that ran workflows, told to stop', { timeout: workflowTestTimeoutMs }, () => {
  it('exits 0 at once, holding nothing open', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;
    await requestTo(port, 'POST', '', { brain: 'alpha', name: 'Alpha' });
    await requestTo(port, 'POST', '/alpha/specs/orchestration', { name: 'greeting', source: greeting });
    const started = await requestTo(port, 'POST', '/alpha/specs/orchestration/greeting/execute', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(port, `/alpha/executions/${executionIdIn(started.body)}`);

    const stopping = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
    expect(exitCode).toBe(0);
    expect(child.output().stderr).not.toContain('was still running');
    expect(performance.now() - stopping).toBeLessThan(3000);
  });

  it.each([
    ['SIGTERM', 0, 'beta'],
    ['SIGKILL', null, 'gamma'],
  ] as const)(
    'stopped with %s while a function a workflow called still runs, exits with %s, and calls it again once started again',
    async (signal, exitedWith, brain) => {
      const gateway = await gatewayThatHangsFirst();
      const first = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
      const executionId = await welcomingStarted(await first.port, brain);
      await gateway.firstHeard;

      const stopping = performance.now();
      first.signal(signal);
      const exitCode = await first.exited;
      const stoppedWithinMs = performance.now() - stopping;
      const second = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
      const settled = await settledOver(await second.port, `/${brain}/executions/${executionId}`);
      second.signal('SIGTERM');

      expect(exitCode).toBe(exitedWith);
      expect(stoppedWithinMs).toBeLessThan(3000);
      expect(first.output().stderr).not.toContain('was still running');
      expect(settled).toMatchObject({ status: 'succeeded', output: 'Welcome, Ada.' });
      expect(gateway.requests()).toBe(2);
      expect(await second.exited).toBe(0);
    },
  );
});
