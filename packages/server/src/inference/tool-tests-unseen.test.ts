import { serveFakeMcp } from '@beonauto/mcp/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { recallTestTimeoutMs } from '../testing/servers/recall-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const onATest = workflowSource(
  'on-a-test',
  'schedule:\n  on: { one: { with: { type: tool_test_started } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const onAClosing = workflowSource(
  'on-a-closing',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const foldingWhatItSees = [
  '---',
  'description: The types of the events this view folds, oldest first',
  'language: jq',
  'source:',
  '  events:',
  '    - type: tool_test_started',
  '    - type: tool_test_answered',
  '    - type: com.acme.ledger.closed',
  'view:',
  '  initial: []',
  '---',
  '. + [$event.type]',
].join('\n');

const RunsSchema = Schema.Struct({ executions: Schema.Array(Schema.Struct({ status: Schema.String })) });

const decodeRuns = Schema.decodeUnknownSync(RunsSchema);

async function servingATestedBrain(): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingWorkflows([], {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: apiKey,
    MCP_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'on-a-test', source: onATest } });
  await server.call('POST', `${alpha}/specs/orchestration`, { body: { name: 'on-a-closing', source: onAClosing } });
  await server.call('POST', `${alpha}/specs/recollection`, { body: { name: 'seen', source: foldingWhatItSees } });
  return server;
}

async function runsOf(server: ReasoningServer, name: string) {
  const { body } = await server.call('GET', `${alpha}/executions?primitive=orchestration&name=${name}`);
  return decodeRuns(body).executions;
}

describe('the tests of a tool in a brain', { timeout: recallTestTimeoutMs }, () => {
  it('reach no recall function and start no workflow, while the events after them do', async () => {
    const server = await servingATestedBrain();

    const tested = await server.call('POST', `${alpha}/tool-servers/graph/tools/search/test`, {
      body: { arguments: { query: 'acme' } },
    });
    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'october' } } },
    });
    const triggered = await vi.waitFor(
      async () => {
        const runs = await runsOf(server, 'on-a-closing');
        expect(runs).toMatchObject([{ status: 'succeeded' }]);
        return runs;
      },
      { timeout: recallTestTimeoutMs - 10_000, interval: 100 },
    );
    const recalled = await vi.waitFor(
      async () => {
        const ran = await server.call('POST', `${alpha}/specs/recollection/seen/execute`, { body: {} });
        expect(ran.body).toMatchObject({ status: 'succeeded', output: ['com.acme.ledger.closed'] });
        return ran.body;
      },
      { timeout: recallTestTimeoutMs - 10_000, interval: 100 },
    );

    expect(tested).toMatchObject({ status: 200, body: { outcome: 'result' } });
    expect(triggered).toHaveLength(1);
    expect(await runsOf(server, 'on-a-test')).toEqual([]);
    expect(recalled).toMatchObject({ output: ['com.acme.ledger.closed'] });
    expect(await runsOf(server, 'on-a-test')).toEqual([]);
  });
});
