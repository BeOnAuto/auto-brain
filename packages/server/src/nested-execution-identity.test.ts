import { randomUUID } from 'node:crypto';

import { answers, textResult } from '@beonauto/inference/testing';
import type { CallerIdentity } from '@beonauto/operations';
import {
  executeSpecThroughActivity,
  executeSpecTwiceThroughActivity,
  type ActivityTarget,
} from '@beonauto/orchestration/testing/activity-caller';
import { afterEach, describe, expect, inject, it } from 'vitest';

import { alpha, servingInference, type InferenceServer } from './testing/inference-server.ts';
import { workflowTestTimeoutMs } from './testing/workflow-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const writer: CallerIdentity = { id: 'writer', org: 'acme', permissions: ['brain:read', 'brain:write'], brains: '*' };

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

async function servingSummary(): Promise<ActivityTarget> {
  const address = inject('temporalAddress');
  const taskQueue = `server-${randomUUID()}`;
  server = await servingInference([answers(textResult('Short.')), answers(textResult('Again.'))], {
    LOCAL_MODE: 'true',
    TEMPORAL_ADDRESS: address,
    TEMPORAL_TASK_QUEUE: taskQueue,
  });
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  return { address, taskQueue, workflowId: `acme/alpha/outer/${randomUUID()}` };
}

function summarizing(caller: CallerIdentity) {
  return {
    org: 'acme',
    brain: 'alpha',
    caller,
    reference: '/do/0/summarize',
    run: 1,
    primitive: 'inference',
    name: 'summary',
    input: { text: 'long' },
  };
}

describe('a nested execution', { timeout: workflowTestTimeoutMs }, () => {
  it('acts as the caller who started the workflow, so a caller without the brain is refused', async () => {
    const target = await servingSummary();
    const outsider: CallerIdentity = { ...writer, id: 'outsider', brains: ['beta'] };

    const answer = await executeSpecThroughActivity(target, summarizing(outsider));

    expect(answer).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(server.modelCalls()).toBe(0);
  });

  it('runs under the id its workflow run, task and run of the task give it, so a retried call runs the spec once', async () => {
    const target = await servingSummary();

    const replies = await executeSpecTwiceThroughActivity(target, summarizing(writer));

    expect(replies).toStrictEqual([
      { status: 'succeeded', output: 'Short.' },
      { status: 'succeeded', output: 'Short.' },
    ]);
    expect(server.modelCalls()).toBe(1);
  });
});
