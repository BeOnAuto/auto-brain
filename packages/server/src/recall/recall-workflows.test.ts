import { withMcpSession } from '@beonauto/api/testing';
import { answers, jsonResult, type ScriptedReply } from '@beonauto/inference/testing';
import { recallDocument } from '@beonauto/recollection/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  brainWithReviews,
  inState,
  liveWith,
  recallTestTimeoutMs,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';
import { executionIdIn, settledExecution, settledOverMcp, workflowSource } from '../testing/servers/workflow-server.ts';

const advise = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {reviews: {type: array}}, required: [reviews]}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Given the verdicts this brain reached on the campaign before, {{ input.reviews }}, should it approve the campaign?',
].join('\n');

const tally = [
  '---',
  'language: jq',
  '---',
  '{ approvals: (.reviews | map(select(.verdict == "approve")) | length),',
  '  rejections: (.reviews | map(select(.verdict == "reject")) | length),',
  '  approve: .advice.approve }',
].join('\n');

const stalling = recallDocument(
  'error("cannot fold this")',
  'language: jq\nsource:\n  events:\n    - type: execution_succeeded\n      subject: inference/review-brief',
);

function recallingWorkflow(name: string, recall: string): string {
  return workflowSource(
    name,
    `do:
  - recall:
      try:
        - remember:
            call: execute_spec
            with: { primitive: recollection, name: ${recall}, input: { campaign: '\${ .campaign }' } }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: PT0.05S
          limit:
            attempt: { count: 3 }
      export:
        as: '\${ { reviews: . } }'
  - advise:
      call: execute_spec
      with: { primitive: inference, name: advise, input: { reviews: '\${ $context.reviews }' } }
  - tally:
      call: execute_spec
      with: { primitive: computation, name: tally, input: { reviews: '\${ $context.reviews }', advice: '\${ . }' } }
`,
  );
}

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(...more: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const server = await servingRecall([
    ...verdicts({ campaign: 'spring', verdict: 'approve' }, { campaign: 'spring', verdict: 'reject' }),
    ...more,
  ]);
  closing.push(server.stop);
  await brainWithReviews(server, 2);
  const definitions = [
    ['inference', 'advise', advise],
    ['computation', 'tally', tally],
    ['recollection', 'stalling', stalling],
    ['orchestration', 'decide', recallingWorkflow('decide', 'reviews')],
    ['orchestration', 'stuck', recallingWorkflow('stuck', 'stalling')],
  ] as const;
  await definitions.reduce(
    (created: Promise<unknown>, [primitive, name, source]) =>
      created.then(() => server.call('POST', `${alpha}/specs/${primitive}`, { body: { name, source } })),
    Promise.resolve(),
  );
  await standingUntil(server, 'reviews', liveWith(2));
  return server;
}

async function settledRun(server: ReasoningServer, workflow: string) {
  const started = await server.call('POST', `${alpha}/specs/orchestration/${workflow}/execute`, {
    body: { input: { campaign: 'spring' } },
  });
  return settledExecution(server, `${alpha}/executions/${executionIdIn(started.body)}`);
}

describe('a workflow that recalls, reasons and computes', { timeout: recallTestTimeoutMs }, () => {
  it('gives the reasoning function the verdicts the brain reached before, and tallies them with its advice', async () => {
    const server = await serving(answers(jsonResult({ approve: false })));

    const settled = await settledRun(server, 'decide');

    expect(settled).toMatchObject({
      body: { status: 'succeeded', output: { approvals: 1, rejections: 1, approve: false } },
    });
    expect(server.modelCalls()).toBe(3);
  });

  it('retries only what is unavailable, so a stalled recall function, a conflict, is run once and the workflow ends', async () => {
    const server = await serving();
    await standingUntil(server, 'stalling', inState('stalled'));

    const settled = await settledRun(server, 'stuck');
    const recalls = await server.call('GET', `${alpha}/executions?primitive=recollection`);

    expect(settled).toMatchObject({ body: { status: 'rejected' } });
    expect(recalls.body).toMatchObject({
      executions: [{ name: 'stalling', status: 'rejected', rejection: { reason: 'conflict', kind: 'stalled' } }],
    });
    expect(server.modelCalls()).toBe(2);
  });

  it('runs over MCP as it does over HTTP', async () => {
    const server = await serving(answers(jsonResult({ approve: true })));

    const settled = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} },
      async (session) => {
        const started = await session.callTool('execute_spec', {
          primitive: 'orchestration',
          name: 'decide',
          input: { campaign: 'spring' },
        });
        return settledOverMcp(session, String(started.structuredContent?.['execution_id']));
      },
    );

    expect(settled.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { approvals: 1, rejections: 1, approve: true },
    });
  });
});
