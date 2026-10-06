import { answers, textResult } from '@beonauto/inference/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { TestResponse } from '../testing/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/reasoning-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const asking = workflowSource(
  'asking',
  "do:\n  - ask: { call: execute_spec, with: { primitive: inference, name: summary, input: { text: 'long' } } }\n",
);

const nesting = workflowSource(
  'nesting',
  'do:\n  - nest: { call: execute_spec, with: { primitive: orchestration, name: asking } }\n',
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingAsking(): Promise<void> {
  server = await servingWorkflows([answers(textResult('Short.')), answers(textResult('Again.'))]);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'asking', source: asking } });
}

async function settledRunOf(name: string): Promise<TestResponse> {
  const started = await server.call('POST', `${alpha}/specs/orchestration/${name}/execute`, { body: { input: {} } });
  return settledExecution(server, `${alpha}/executions/${executionIdIn(started.body)}`);
}

describe('a nested execution of a workflow', { timeout: workflowTestTimeoutMs }, () => {
  it('runs under the id its workflow gives it, so a call again with that id runs the spec once', async () => {
    await servingAsking();

    const settled = await settledRunOf('asking');
    const nested = String(server.modelExecutions()[0]);
    const again = await server.call('POST', `${alpha}/specs/inference/summary/execute`, {
      body: { input: { text: 'long' }, execution_id: nested },
    });

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(again).toMatchObject({ status: 200, body: { execution_id: nested, status: 'succeeded', output: 'Short.' } });
    expect(server.modelCalls()).toBe(1);
  });

  it('cannot be of another workflow: a workflow that names one is refused when it is created', async () => {
    await servingAsking();

    const created = await server.call('POST', `${alpha}/specs/orchestration`, {
      body: { name: 'nesting', source: nesting },
    });

    expect(created.status).toBe(422);
    expect(created.text).toContain('A workflow cannot execute another workflow in this version');
  });
});
