import { withMcpSession } from '@beonauto/api/testing';
import { answers, textResult } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { interactionServerOn } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { fencedBlocksOf, pageOf, tutorialRunOn } from '../testing/servers/tutorial-calls.ts';
import { executionIdIn, servingWorkflows, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const reference = fencedBlocksOf('reference/interaction-format.md');

const decodeAnswer = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

describe('the example of the interaction function format', { timeout: workflowTestTimeoutMs }, () => {
  it('asks through the inbox in a workflow that takes the answer the page shows as its output', async () => {
    const server = await interactionServerOn({});
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/interaction`, {
      body: { name: 'approve-brief', source: reference.get('markdown') },
    });
    await server.call('POST', `${alpha}/specs/orchestration`, {
      body: { name: 'brief-approval', source: reference.get('yaml') },
    });
    const started = await server.call('POST', `${alpha}/specs/orchestration/brief-approval/execute`, {
      body: { input: { campaign: 'Spring', owner: 'ada', summary: 'A brief for the spring sale.' } },
    });
    const [request] = await server.openRequests(1);
    const answered = await server.answer(String(request), decodeAnswer(reference.get('json')));

    expect(answered.status).toBe(200);
    expect(await server.settled(executionIdIn(started.body))).toMatchObject({
      status: 'succeeded',
      output: { choice: 'approve', note: 'Ready to launch.' },
    });
  });
});

describe('the tutorial of a first workflow', { timeout: workflowTestTimeoutMs }, () => {
  it('reviews, asks through the inbox and ends with the answer, in the words the tutorial and the MCP reference quote', async () => {
    const server = await servingWorkflows([answers(textResult('Revise: the audience lacks a job role.'))]);
    onTestFinished(server.stop);
    const run = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, tutorialRunOn);
    const quoted = `${pageOf('tutorials/first-workflow.md')}\n${pageOf('reference/mcp.md')}`;

    expect(run.summaries.filter((summary) => !quoted.includes(summary))).toEqual([]);
    expect(run.output).toEqual({
      review: 'Revise: the audience lacks a job role.',
      approval: { verdict: 'approve', note: 'Approved for the autumn launch.' },
    });
    expect(run.answeredAgain).toBe(true);
  });
});
