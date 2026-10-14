import { serveFakeMcp } from '@on.auto/tool-servers/testing';
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

const onACall = workflowSource(
  'on-a-call',
  'schedule:\n  on: { one: { with: { type: tool_call_started } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const onAClosing = workflowSource(
  'on-a-closing',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const foldingWhatItSees = [
  '---',
  'description: The types of the events this view folds, oldest first',
  'language: typescript',
  'source:',
  '  events:',
  '    - type: tool_call_started',
  '    - type: tool_call_answered',
  '    - type: com.acme.ledger.closed',
  'view:',
  '  initial: []',
  '  schema: {type: array, items: {type: string}}',
  '---',
  'export function fold(view: View, event: Event): View {',
  '  return [...view, event.type];',
  '}',
].join('\n');

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ status: Schema.String })) });

const decodeRuns = Schema.decodeUnknownSync(RunsSchema);

interface CalledPlaybook {
  readonly server: ReasoningServer;
  readonly saved: readonly number[];
}

async function servingACalledPlaybook(): Promise<CalledPlaybook> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingWorkflows([], {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const saving = [
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-a-call', source: onACall } }),
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-a-closing', source: onAClosing } }),
    await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'seen', source: foldingWhatItSees } }),
  ];
  return { server, saved: saving.map(({ status }) => status) };
}

async function runsOf(server: ReasoningServer, name: string) {
  const { body } = await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`);
  return decodeRuns(body).runs;
}

describe('the calls made by hand in a playbook', { timeout: recallTestTimeoutMs }, () => {
  it('reach no recall function and start no workflow, while the events after them do', async () => {
    const { server, saved } = await servingACalledPlaybook();

    const called = await server.call('POST', `${alpha}/tool-servers/graph/tools/search/execute`, {
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
        const ran = await server.call('POST', `${alpha}/definitions/recall/seen/run`, { body: {} });
        expect(ran.body).toMatchObject({ status: 'succeeded', output: ['com.acme.ledger.closed'] });
        return ran.body;
      },
      { timeout: recallTestTimeoutMs - 10_000, interval: 100 },
    );

    expect(saved).toEqual([201, 201, 201]);
    expect(called).toMatchObject({ status: 200, body: { outcome: 'result' } });
    expect(triggered).toHaveLength(1);
    expect(await runsOf(server, 'on-a-call')).toEqual([]);
    expect(recalled).toMatchObject({ output: ['com.acme.ledger.closed'] });
    expect(await runsOf(server, 'on-a-call')).toEqual([]);
  });
});
