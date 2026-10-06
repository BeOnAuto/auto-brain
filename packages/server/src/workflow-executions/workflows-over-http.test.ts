import { answers, jsonResult, textResult, type ScriptedReply } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type InferenceServer } from '../testing/inference-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const expenseReview = workflowSource(
  'expense-review',
  `do:
  - judge:
      call: execute_spec
      with:
        primitive: inference
        name: verdict
        input: { expense: '\${ .expense }' }
      output:
        as: '\${ $input + { approve: .approve } }'
  - route:
      switch:
        - approved: { when: .approve == true, then: describe }
        - declined: { then: decline }
  - describe:
      call: execute_spec
      with:
        primitive: inference
        name: summary
        input: { text: '\${ .expense }' }
      output:
        as: '\${ { approved: true, summary: . } }'
      then: end
  - decline:
      set: { approved: false }
`,
);

const recovering = workflowSource(
  'recovering',
  `do:
  - attempt:
      try:
        - describe:
            call: execute_spec
            with: { primitive: inference, name: summary, input: { text: 7 } }
      catch:
        errors: { with: { status: 400 } }
        do:
          - recover: { set: { recovered: true } }
`,
);

const careless = workflowSource(
  'careless',
  `do:
  - describe:
      call: execute_spec
      with: { primitive: inference, name: summary, input: { text: 7 } }
`,
);

const historyOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

async function serving(...replies: readonly ScriptedReply[]): Promise<void> {
  server = await servingWorkflows(replies);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'verdict', source: verdict } });
  await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/specs/orchestration`, {
    body: { name: 'expense-review', source: expenseReview },
  });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'recovering', source: recovering } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'careless', source: careless } });
}

async function executed(name: string, input: object): Promise<string> {
  const response = await server.call('POST', `${alpha}/specs/orchestration/${name}/execute`, { body: { input } });
  expect(response).toMatchObject({ status: 200, body: { status: 'started' } });
  return executionIdIn(response.body);
}

describe('a workflow that executes inference specs, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('branches on the first answer, executes the second spec, and settles succeeded with what it composed', async () => {
    await serving(answers(jsonResult({ approve: true })), answers(textResult('Dinner for six, within policy.')));

    const executionId = await executed('expense-review', { expense: 'a team dinner' });
    const settled = await settledExecution(server, `${alpha}/executions/${executionId}`);

    expect(settled).toMatchObject({
      status: 200,
      body: {
        execution_id: executionId,
        primitive: 'orchestration',
        name: 'expense-review',
        status: 'succeeded',
        output: { approved: true, summary: 'Dinner for six, within policy.' },
        started_by: 'local',
      },
    });
  });

  it('leaves each nested execution in the ledger under its own id, run as the caller who started the workflow', async () => {
    await serving(answers(jsonResult({ approve: true })), answers(textResult('Within policy.')));

    const executionId = await executed('expense-review', { expense: 'a taxi' });
    await settledExecution(server, `${alpha}/executions/${executionId}`);
    const nested = await Promise.all(
      server.modelExecutions().map((id) => server.call('GET', `${alpha}/executions/${String(id)}`)),
    );

    expect(new Set([executionId, ...server.modelExecutions()]).size).toBe(3);
    expect(nested.map(({ body }) => body)).toMatchObject([
      { primitive: 'inference', name: 'verdict', status: 'succeeded', output: { approve: true }, started_by: 'local' },
      { primitive: 'inference', name: 'summary', status: 'succeeded', output: 'Within policy.', started_by: 'local' },
    ]);
  });

  it('takes the other branch on the other answer, without executing the second spec', async () => {
    await serving(answers(jsonResult({ approve: false })));

    const executionId = await executed('expense-review', { expense: 'a yacht' });

    expect(await settledExecution(server, `${alpha}/executions/${executionId}`)).toMatchObject({
      body: { status: 'succeeded', output: { approved: false } },
    });
    expect(server.modelCalls()).toBe(1);
  });
});

describe('a nested spec that rejects its input, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is an error the workflow catches with try, and recovers from', async () => {
    await serving();

    const executionId = await executed('recovering', {});

    expect(await settledExecution(server, `${alpha}/executions/${executionId}`)).toMatchObject({
      body: { status: 'succeeded', output: { recovered: true } },
    });
    expect(server.modelCalls()).toBe(0);
  });

  it('settles the workflow rejected when nothing catches it', async () => {
    await serving();

    const executionId = await executed('careless', {});

    expect(await settledExecution(server, `${alpha}/executions/${executionId}`)).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'invalid_input' } },
    });
  });
});

describe('the history of a workflow run, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('shows each input the run took, with the steps that moved and how they ended', async () => {
    await serving(answers(jsonResult({ approve: false })));

    const executionId = await executed('expense-review', { expense: 'a yacht' });
    await settledExecution(server, `${alpha}/executions/${executionId}`);
    const history = await server.call('GET', `${alpha}/executions/${executionId}/history`);

    const { events } = historyOf(history.body);
    const callKey = JSON.stringify([`acme/alpha/${executionId}`, '/do/0/judge', 1]);

    expect(events.map(({ type }) => type).toSorted()).toEqual([
      'execution_deferred',
      'execution_started',
      'execution_succeeded',
      'workflow_input_applied',
      'workflow_input_applied',
    ]);
    expect(events.filter(({ type }) => type === 'workflow_input_applied')).toEqual([
      {
        type: 'workflow_input_applied',
        summary: 'The workflow started, and 1 step moved.',
        data: {
          execution_id: executionId,
          input: { kind: 'started', key: executionId },
          step_count: 1,
          steps: [{ task: '/do/0/judge', run: 1, outcome: 'waiting' }],
          output_kinds: ['arm_timer', 'start_call'],
        },
      },
      {
        type: 'workflow_input_applied',
        summary: 'A function the workflow called answered, and 3 steps moved; the workflow ended.',
        data: {
          execution_id: executionId,
          input: { kind: 'call_answered', key: callKey, status: 'succeeded' },
          step_count: 3,
          steps: [
            { task: '/do/0/judge', run: 1, outcome: 'completed' },
            { task: '/do/1/route', run: 1, outcome: 'completed' },
            { task: '/do/3/decline', run: 1, outcome: 'completed' },
          ],
          output_kinds: ['cancel_timer', 'settle'],
        },
      },
    ]);
  });
});
