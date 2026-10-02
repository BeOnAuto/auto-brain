import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { describe, expect, inject, it, onTestFinished } from 'vitest';

import { alpha, servingInference } from '../testing/inference-server.ts';
import { temporalProxy, type TemporalProxy } from '../testing/temporal-proxy.ts';
import { executionIdIn, settledExecution, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

const greeting = workflowSource('greeting', 'do:\n  - greet: { set: { greeting: \'${ "Hello, " + .name }\' } }\n');

async function openConnectionsAfter(proxy: TemporalProxy, attempts: number): Promise<number> {
  if (proxy.openConnections() === 0 || attempts <= 1) {
    return proxy.openConnections();
  }
  await setTimeout(100);
  return openConnectionsAfter(proxy, attempts - 1);
}

describe('a server that offered workflows, once stopped', { timeout: workflowTestTimeoutMs }, () => {
  it('has closed every connection it opened to Temporal, its client and its worker', async () => {
    const proxy = await temporalProxy(inject('temporalAddress'));
    onTestFinished(proxy.close);
    const server = await servingInference([], {
      LOCAL_MODE: 'true',
      TEMPORAL_ADDRESS: proxy.address,
      TEMPORAL_TASK_QUEUE: `server-${randomUUID()}`,
    });
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'greeting', source: greeting } });
    const started = await server.call('POST', `${alpha}/specs/orchestration/greeting/execute`, {
      body: { input: { name: 'Ada' } },
    });
    await settledExecution(server, `${alpha}/executions/${executionIdIn(started.body)}`);
    const whileServing = proxy.openConnections();

    await server.stop();

    expect(whileServing).toBeGreaterThanOrEqual(2);
    expect(await openConnectionsAfter(proxy, 30)).toBe(0);
  });
});
