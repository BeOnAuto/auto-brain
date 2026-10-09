import { setTimeout } from 'node:timers/promises';

import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { answers, callingTools, textResult } from '@beonauto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  runIdIn,
  servingWorkflows,
  settledRun,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/servers/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const sleeper = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/sleep]', '---', 'Wait for acme.'].join(
  '\n',
);

const impatient = workflowSource(
  'impatient',
  `do:
  - wait:
      call: run_definition
      with: { type: reasoning, name: sleeper }
      timeout: { after: PT1S }
`,
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(fake: FakeMcpServer): Promise<ReasoningServer> {
  const server = await servingWorkflows(
    [callingTools([['mcp__graph__sleep', { ms: 60_000 }]], answers(textResult('Slept.')))],
    {
      LOCAL_MODE: 'true',
      GRAPH_API_KEY: apiKey,
      MCP_SERVERS: JSON.stringify({
        graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
    },
  );
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'sleeper', source: sleeper } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'impatient', source: impatient } });
  return server;
}

type Seen = ReturnType<FakeMcpServer['seen']>;

async function untilCancelled(fake: FakeMcpServer): Promise<Seen> {
  const seen = fake.seen().filter(({ rpc }) => rpc === 'tools/call' || rpc === 'notifications/cancelled');
  if (seen.some(({ rpc }) => rpc === 'notifications/cancelled')) {
    return seen;
  }
  await setTimeout(50);
  return untilCancelled(fake);
}

describe(
  'a workflow step that times out while its reasoning function calls a tool',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('aborts the call in flight at its MCP server, and leaves the run cancelled with the call started and unanswered', async () => {
      const fake = await serveFakeMcp({ bearer: apiKey });
      closing.push(fake.close);
      const server = await serving(fake);

      const started = await server.call('POST', `${alpha}/definitions/workflow/impatient/run`, {
        body: { input: {} },
      });
      const workflow = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
      const calls = await untilCancelled(fake);
      const nested = String(server.modelRunIds()[0]);
      const run = await settledRun(server, `${alpha}/runs/${nested}`);
      const history = await server.call('GET', `${alpha}/runs/${nested}/history`);
      const again = await server.call('POST', `${alpha}/definitions/reasoning/sleeper/run`, {
        body: { input: {}, run_id: nested },
      });

      expect(workflow).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
      expect(calls.map(({ rpc }) => rpc)).toEqual(['tools/call', 'notifications/cancelled']);
      expect(calls[1]?.session).toBe(calls[0]?.session);
      expect(calls[0]?.session).toEqual(expect.any(String));
      expect(fake.received()).toMatchObject([{ tool: 'sleep', arguments: { ms: 60_000 } }]);
      expect(run).toMatchObject({
        body: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } },
      });
      expect(decodeHistory(history.body).events.map(({ type }) => type)).toEqual([
        'run_started',
        'tool_call_started',
        'run_cancel_requested',
        'run_rejected',
      ]);
      expect(again).toMatchObject({ status: 409, body: { reason: 'cancelled', kind: 'deadline' } });
    });
  },
);
