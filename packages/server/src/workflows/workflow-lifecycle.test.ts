import { setTimeout } from 'node:timers/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { temporaryLedger } from '../testing/temporary-ledger.ts';
import { logLinesOf, requestTo, settledOver, workflowProcess } from '../testing/workflow-process.ts';
import { executionIdIn, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const approval = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ .[0] }' } }\n",
);

const pausing = workflowSource('pausing', 'do:\n  - pause: { wait: PT1S }\n  - done: { set: { paused: true } }\n');

describe('main with workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('says how it runs workflows, and exits 0 at once on SIGTERM', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;

    const stopping = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;
    const startUpLines = logLinesOf(child)
      .filter(({ message }) => !/^(?:Model provider|No model provider)/u.test(message))
      .map(({ message, level }) => `${level} ${message}`);

    expect(exitCode).toBe(0);
    expect(performance.now() - stopping).toBeLessThan(3000);
    expect(child.output().stdout).toBe(`auto-brain listening on port ${port}\n`);
    expect(startUpLines.slice(1)).toEqual([
      `INFO The ledger is kept in the file ${ledger.fileName}`,
      'INFO Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms',
    ]);
    expect(startUpLines[0]).toMatch(/^WARN Local mode is on: /u);
  });
});

describe('a server started again on the ledger of its workflows', { timeout: workflowTestTimeoutMs }, () => {
  it('goes on with a run that waits for an event, and with one whose timer went off while it was stopped', async () => {
    const first = workflowProcess(ledger.fileName);
    const firstPort = await first.port;
    await requestTo(firstPort, 'POST', '', { brain: 'gamma', name: 'Gamma' });
    await requestTo(firstPort, 'POST', '/gamma/specs/orchestration', { name: 'approval', source: approval });
    await requestTo(firstPort, 'POST', '/gamma/specs/orchestration', { name: 'pausing', source: pausing });
    const waiting = await requestTo(firstPort, 'POST', '/gamma/specs/orchestration/approval/execute', { input: {} });
    const paused = await requestTo(firstPort, 'POST', '/gamma/specs/orchestration/pausing/execute', { input: {} });
    first.signal('SIGTERM');
    await first.exited;
    await setTimeout(1500);

    const second = workflowProcess(ledger.fileName);
    const port = await second.port;
    const sent = await requestTo(port, 'POST', `/gamma/executions/${executionIdIn(waiting.body)}/events`, {
      event: { type: 'com.acme.approved', data: { by: 'Ada' } },
    });
    const approved = await settledOver(port, `/gamma/executions/${executionIdIn(waiting.body)}`);
    const pausedSettled = await settledOver(port, `/gamma/executions/${executionIdIn(paused.body)}`);
    second.signal('SIGTERM');

    expect(sent.status).toBe(200);
    expect(approved).toMatchObject({ status: 'succeeded', output: { by: 'Ada' } });
    expect(pausedSettled).toMatchObject({ status: 'succeeded', output: { paused: true } });
    expect(await second.exited).toBe(0);
  });
});
