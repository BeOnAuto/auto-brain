import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/reasoning-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const waiting = workflowSource(
  'waiting',
  'do:\n  - await: { listen: { to: { one: { with: { type: com.acme.never } } } } }\n',
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function waitingExecution(): Promise<string> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'waiting', source: waiting } });
  const started = await server.call('POST', `${alpha}/specs/orchestration/waiting/execute`, { body: { input: {} } });
  return executionIdIn(started.body);
}

async function flood(executionId: string, count: number, data: string): Promise<readonly number[]> {
  const statuses = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const sent = await server.call('POST', `${alpha}/executions/${executionId}/events`, {
        body: { event: { id: `e${index}`, type: 'com.acme.flood', data } },
      });
      return sent.status;
    }),
  );
  return [...new Set(statuses)].toSorted((first, second) => first - second);
}

describe('a workflow flooded with events it does not consume', { timeout: workflowTestTimeoutMs }, () => {
  it('fails once more than 64 wait, settles rejected, and answers later events not found', async () => {
    const executionId = await waitingExecution();

    const answered = await flood(executionId, 80, 'small');
    const settled = await settledExecution(server, `${alpha}/executions/${executionId}`);
    const later = await server.call('POST', `${alpha}/executions/${executionId}/events`, {
      body: { event: { type: 'com.acme.flood' } },
    });

    expect(answered).toContain(200);
    expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
    expect(settled.text).toContain('The workflow was sent more events than it consumed');
    expect(later).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });

  it('fails once more than 1 MiB of events waits, however few they are', async () => {
    const executionId = await waitingExecution();

    await flood(executionId, 8, 'x'.repeat(200_000));
    const settled = await settledExecution(server, `${alpha}/executions/${executionId}`);

    expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
  });
});
