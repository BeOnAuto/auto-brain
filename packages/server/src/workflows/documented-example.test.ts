import { answers, textResult } from '@beonauto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, servingWorkflows, settledRun, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const [reviewAndApprove] = blocksInOrderOf('reference/workflow-format.md').map(({ body }) => body);

const reviewCampaignBrief = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {brief: {type: string}}, required: [brief]}',
  '---',
  'Review this brief against the four criteria: {{ input.brief }}',
].join('\n');

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('the example of the workflow format, through the server', { timeout: workflowTestTimeoutMs }, () => {
  it('reviews the brief, waits for the decision, and ends approved with the review', async () => {
    server = await servingWorkflows([answers(textResult('Approve: the brief names its audience.'))]);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'review-campaign-brief', source: reviewCampaignBrief },
    });

    const created = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'review-and-approve', source: reviewAndApprove },
    });
    const started = await server.call('POST', `${alpha}/definitions/workflow/review-and-approve/run`, {
      body: { input: { brief: 'Spring sale for returning customers.' } },
    });
    const runId = runIdIn(started.body);
    await server.call('POST', `${alpha}/runs/${runId}/events`, {
      body: { event: { type: 'com.example.brief.decided', data: { approved: true } } },
    });

    expect(created.status).toBe(201);
    expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
      body: { status: 'succeeded', output: { approved: true, review: 'Approve: the brief names its audience.' } },
    });
  });
});
