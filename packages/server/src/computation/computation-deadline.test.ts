import { computationBounds } from '@beonauto/computation';
import { campaignPace, campaignRows } from '@beonauto/computation/testing';
import { programPool } from '@beonauto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';

const blockingWorker = new URL(`data:text/javascript,${encodeURIComponent('while (true) {}')}`);

const timerSlackMs = 2;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('a run of a computation function that does not end by itself, over HTTP', { timeout: 60_000 }, () => {
  it('is unavailable once its worker is terminated at the deadline, while the server answers other requests', async () => {
    server = await servingReasoning([], { LOCAL_MODE: 'true' }, undefined, ({ workers }) =>
      programPool({ workers, heapMegabytes: computationBounds.heapMegabytes, worker: blockingWorker }),
    );
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/computation`, { body: { name: 'pace', source: campaignPace } });
    const started = performance.now();
    const settled = { run: false };

    const running = server
      .call('POST', `${alpha}/specs/computation/pace/execute`, { body: { input: campaignRows(2) } })
      .then((response) => {
        settled.run = true;
        return { response, milliseconds: performance.now() - started };
      });
    const meanwhile = await server.call('GET', `${alpha}/specs/computation/pace`);

    expect(meanwhile).toMatchObject({ status: 200, body: { name: 'pace' } });
    expect(settled.run).toBe(false);
    const { response, milliseconds } = await running;
    expect(response).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'The run took longer than the 10000 ms a computation function may run, and was stopped',
      },
    });
    expect(milliseconds).toBeGreaterThanOrEqual(computationBounds.deadlineMs - timerSlackMs);
  });
});
