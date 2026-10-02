import { randomUUID } from 'node:crypto';

import type { CallerIdentity } from '@beonauto/operations';
import { installTemporalRuntime, type TemporalLogEntry } from '@beonauto/orchestration';
import { executeSpecThroughActivity } from '@beonauto/orchestration/testing/activity-caller';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { temporaryLedger } from '../testing/temporary-ledger.ts';
import { loggedWithin, untilLogged, workflowProcess } from '../testing/workflow-process.ts';
import { workflowTestTimeoutMs } from '../testing/workflow-server.ts';

const ledger = temporaryLedger();

const temporalLogsOfThisProcess: TemporalLogEntry[] = [];

afterAll(() => {
  ledger.remove();
});

const caller: CallerIdentity = { id: 'writer', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' };

describe('a server whose worker Temporal reports a failure of', { timeout: workflowTestTimeoutMs }, () => {
  it('logs it as an operator line with the fields that describe it', async () => {
    installTemporalRuntime((entry) => {
      temporalLogsOfThisProcess.push(entry);
    });
    const address = inject('temporalAddress');
    const taskQueue = `server-${randomUUID()}`;
    const child = workflowProcess(ledger.fileName, address, taskQueue);
    await child.port;
    await untilLogged(child, (message) => message === 'The workflow worker started');

    const answer = await executeSpecThroughActivity(
      { address, taskQueue, workflowId: `globex/gamma/outer/${randomUUID()}` },
      {
        org: 'acme',
        brain: 'alpha',
        caller,
        reference: '/do/0/ask',
        run: 1,
        primitive: 'inference',
        name: 'ask',
        input: {},
      },
    ).then(
      () => 'answered',
      () => 'refused',
    );
    const reported = await loggedWithin(child, (message) => message === 'Temporal reported: Activity failed', 40);
    child.signal('SIGTERM');
    await child.exited;

    expect(answer).toBe('refused');
    expect(reported).toMatchObject({
      level: 'WARN',
      annotations: { activityType: 'executeSpec', errorType: 'TenancyViolation' },
    });
  });
});
