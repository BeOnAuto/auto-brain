import { TimedOut } from '@beonauto/inference';
import { callingTools, type ScriptedReply } from '@beonauto/inference/testing';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type InferenceServer } from '../testing/inference-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

function reasonFunction(tool: string): string {
  return ['---', 'model: anthropic/claude-sonnet-4-5', `tools: [${tool}]`, '---', 'Find acme.'].join('\n');
}

function workflowCalling(name: string, spec: string, caught: boolean): string {
  const call = `{ call: execute_spec, with: { primitive: inference, name: ${spec} } }`;
  return workflowSource(
    name,
    caught
      ? `do:
  - lookup:
      try:
        - find: ${call}
      catch:
        as: failure
        do:
          - report:
              set: '\${ { kind: $failure.kind, because: $failure.because } }'
`
      : `do:\n  - find: ${call}\n`,
  );
}

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const unfinishedWords: unknown = expect.stringMatching(
  /did not succeed, .*; the workflow ended\. It called tools but could not finish, because the model stopped answering\.$/u,
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(...replies: readonly ScriptedReply[]): Promise<InferenceServer> {
  const fake: FakeMcpServer = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } };
  const server = await servingWorkflows(replies, {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: apiKey,
    MCP_SERVERS: JSON.stringify({ graph: { ...graph, org: 'acme' }, crm: { ...graph, org: 'globex' } }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/inference`, {
    body: { name: 'graph', source: reasonFunction('graph/search') },
  });
  await server.call('POST', `${alpha}/specs/inference`, {
    body: { name: 'crm', source: reasonFunction('crm/search') },
  });
  await server.call('POST', `${alpha}/specs/orchestration`, {
    body: { name: 'reporting', source: workflowCalling('reporting', 'crm', true) },
  });
  await server.call('POST', `${alpha}/specs/orchestration`, {
    body: { name: 'careless', source: workflowCalling('careless', 'graph', false) },
  });
  return server;
}

async function settledRun(server: InferenceServer, name: string) {
  const started = await server.call('POST', `${alpha}/specs/orchestration/${name}/execute`, { body: { input: {} } });
  const executionId = executionIdIn(started.body);
  const settled = await settledExecution(server, `${alpha}/executions/${executionId}`);
  const history = await server.call('GET', `${alpha}/executions/${executionId}/history`);
  const answers = decodeHistory(history.body).events.filter(({ summary }) => summary.startsWith('A function'));
  return { settled, answers };
}

describe(
  'a workflow calling a reason function whose tools end it, over HTTP',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('catches the kind and because of a tool the server does not offer, and its history says why', async () => {
      const server = await serving();

      const { settled, answers } = await settledRun(server, 'reporting');

      expect(settled).toMatchObject({
        body: { status: 'succeeded', output: { kind: 'tool_not_offered', because: 'mcp_server_not_configured' } },
      });
      expect(answers).toMatchObject([
        {
          summary:
            'A function the workflow called did not succeed, and 3 steps moved; the workflow ended. This server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this brain.',
          data: {
            input: {
              status: 'rejected',
              rejection: { kind: 'tool_not_offered', because: 'mcp_server_not_configured' },
            },
          },
        },
      ]);
      expect(server.modelCalls()).toBe(0);
    });

    it('ends with the kind and because of tools that could not finish when nothing catches them', async () => {
      const server = await serving(callingTools([['mcp__graph__search', { query: 'acme' }]], timedOut));

      const { settled, answers } = await settledRun(server, 'careless');

      expect(settled).toMatchObject({
        body: {
          status: 'rejected',
          rejection: { reason: 'unavailable', kind: 'tools_unfinished', because: 'model_unavailable' },
        },
      });
      expect(answers).toMatchObject([
        {
          summary: unfinishedWords,
          data: { input: { rejection: { kind: 'tools_unfinished', because: 'model_unavailable' } } },
        },
      ]);
    });
  },
);
