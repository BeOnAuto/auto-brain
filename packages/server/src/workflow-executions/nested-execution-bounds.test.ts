import { answers, textResult } from '@beonauto/inference/testing';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, inject, it } from 'vitest';

import { alpha, type InferenceServer } from '../testing/inference-server.ts';
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

const decodeScheduled = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({
        activityTaskScheduledEventAttributes: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              activityType: Schema.Struct({ name: Schema.String }),
              startToCloseTimeout: Schema.Struct({ seconds: Schema.Unknown }),
              heartbeatTimeout: Schema.Struct({ seconds: Schema.Unknown }),
            }),
          ),
        ),
      }),
    ),
  }),
);

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

function scheduledActivities(history: unknown): readonly (readonly [string, number, number])[] {
  return decodeScheduled(history).events.flatMap(({ activityTaskScheduledEventAttributes: scheduled }) =>
    scheduled === null || scheduled === undefined
      ? []
      : [
          [
            scheduled.activityType.name,
            Number(scheduled.startToCloseTimeout.seconds),
            Number(scheduled.heartbeatTimeout.seconds),
          ],
        ],
  );
}

describe('a nested execution of a workflow', { timeout: workflowTestTimeoutMs }, () => {
  it('may run as long as its primitive states, 1660 s for inference, and a minute more, and heartbeats every 30 s at most', async () => {
    server = await servingWorkflows([answers(textResult('Short.'))]);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/specs/inference`, { body: { name: 'summary', source: summary } });
    await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'asking', source: asking } });
    const started = await server.call('POST', `${alpha}/specs/orchestration/asking/execute`, { body: { input: {} } });
    const executionId = executionIdIn(started.body);
    const settled = await settledExecution(server, `${alpha}/executions/${executionId}`);
    const temporal = await TestWorkflowEnvironment.createFromExistingServer({ address: inject('temporalAddress') });
    const history = await temporal.client.workflow.getHandle(`acme/alpha/asking/${executionId}`).fetchHistory();
    await temporal.teardown();

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(scheduledActivities(history)).toStrictEqual([['executeSpec', 1720, 30]]);
  });
});
