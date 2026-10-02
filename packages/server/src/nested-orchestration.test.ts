import { randomUUID } from 'node:crypto';

import type { CallerIdentity } from '@beonauto/operations';
import { executeSpecThroughActivity } from '@beonauto/orchestration/testing/activity-caller';
import { afterEach, describe, expect, inject, it } from 'vitest';

import { alpha, servingInference, type InferenceServer } from './testing/inference-server.ts';
import { workflowSource, workflowTestTimeoutMs } from './testing/workflow-server.ts';

const caller: CallerIdentity = { id: 'local', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' };

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

describe('a nested execution that names orchestration', { timeout: workflowTestTimeoutMs }, () => {
  it('is rejected as not found by the dispatcher of the worker, which serves workflows no workflow', async () => {
    const address = inject('temporalAddress');
    const taskQueue = `server-${randomUUID()}`;
    server = await servingInference([], {
      LOCAL_MODE: 'true',
      TEMPORAL_ADDRESS: address,
      TEMPORAL_TASK_QUEUE: taskQueue,
    });
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/orchestration`, {
      body: { name: 'inner', source: workflowSource('inner', 'do: []\n') },
    });

    const answer = await executeSpecThroughActivity(
      { address, taskQueue, workflowId: `acme/alpha/outer/${randomUUID()}` },
      {
        org: 'acme',
        brain: 'alpha',
        caller,
        reference: '/do/0/nest',
        run: 1,
        primitive: 'orchestration',
        name: 'inner',
        input: {},
      },
    );

    expect(answer).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});
