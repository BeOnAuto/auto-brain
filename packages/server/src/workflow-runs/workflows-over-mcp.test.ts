import { setTimeout } from 'node:timers/promises';

import { listedTools, toolNamesIn, withMcpSession, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { answers, jsonResult, type ScriptedReply } from '@beonauto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const approval = workflowSource(
  'approval',
  `do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: '\${ $data.expense }' } }
      output:
        as: '\${ ({ approve: $data.approve }) }'
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
      output:
        as: '\${ ({ decided: $data[0] }) }'
`,
);

const brainTools = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'get_run_history',
  'get_brain_analytics',
  'list_brain_events',
  'publish_event',
  'list_tool_servers',
  'test_tool_call',
  'answer_interaction',
  'list_interactions',
  'send_run_event',
];

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onAlphaOf<T>(served: ReasoningServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${served.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

async function onAlpha<T>(replies: readonly ScriptedReply[], use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingWorkflows(replies);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return onAlphaOf(server, use);
}

async function settled(session: McpSession, runId: string): Promise<ToolResult> {
  const reading = await session.callTool('get_run', { run_id: runId });
  if (reading.structuredContent?.['status'] !== 'started') {
    return reading;
  }
  await setTimeout(100);
  return settled(session, runId);
}

const typeField = Schema.decodeUnknownSync(
  Schema.Struct({ properties: Schema.Struct({ type: Schema.Struct({ enum: Schema.Array(Schema.String) }) }) }),
);

function typesOfCreateDefinition(listing: unknown): readonly string[] {
  const createDefinition = listedTools(listing).filter(({ name }) => name === 'create_definition');
  return createDefinition.flatMap(({ inputSchema }) => typeField(inputSchema).properties.type.enum);
}

describe('workflows over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('lists eighteen tools on the endpoint of a brain, and every capability in the definition tools', async () => {
    const listing = await onAlpha([], (session) => session.listTools());

    expect(toolNamesIn(listing)).toEqual([...brainTools, 'get_guide']);
    expect(typesOfCreateDefinition(listing)).toEqual(['reasoning', 'interaction', 'computation', 'recall', 'workflow']);
  });

  it('executes a workflow that calls a reasoning function definition and waits for an event the tools send', async () => {
    const { started, sent, run } = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
      await session.callTool('create_definition', { type: 'reasoning', name: 'verdict', source: verdict });
      await session.callTool('create_definition', { type: 'workflow', name: 'approval', source: approval });
      const starting = await session.callTool('run_definition', {
        type: 'workflow',
        name: 'approval',
        input: { expense: 'a taxi' },
      });
      const runId = String(starting.structuredContent?.['run_id']);
      const sending = await session.callTool('send_run_event', {
        run_id: runId,
        event: { type: 'com.acme.approval.decided', data: 'yes' },
      });
      return { started: starting, sent: sending, run: await settled(session, runId) };
    });

    expect(started.structuredContent).toMatchObject({ type: 'workflow', status: 'started' });
    expect(sent.structuredContent).toMatchObject({ event: { type: 'com.acme.approval.decided', data: 'yes' } });
    expect(run.structuredContent).toMatchObject({ status: 'succeeded', output: { decided: 'yes' } });
  });
});

const EventsSchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      causation_id: Schema.NullOr(Schema.String),
      type: Schema.String,
      data: Schema.Struct({ name: Schema.optionalKey(Schema.String), run_id: Schema.optionalKey(Schema.String) }),
    }),
  ),
});

const eventsOf = Schema.decodeUnknownSync(EventsSchema);

type Event = (typeof EventsSchema.Type)['events'][number];

function stepOf(events: readonly Event[], type: string, name: string): Event | undefined {
  return events.find((event) => event.type === type && event.data.name === name);
}

function startOf(events: readonly Event[], runId: string | undefined): Event | undefined {
  return events.find(({ type, data }) => type === 'run_started' && data.run_id === runId);
}

function causesNamedNowhereIn(events: readonly Event[]): readonly string[] {
  const ids = new Set(events.map(({ id }) => id));
  return events.flatMap(({ causation_id: cause }) => (cause === null || ids.has(cause) ? [] : [cause]));
}

describe('the graph of a workflow run over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('reads the steps of a run with their causes, and the whole tree of the run in the feed of its brain', async () => {
    const { history, tree } = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
      await session.callTool('create_definition', { type: 'reasoning', name: 'verdict', source: verdict });
      await session.callTool('create_definition', { type: 'workflow', name: 'approval', source: approval });
      const starting = await session.callTool('run_definition', {
        type: 'workflow',
        name: 'approval',
        input: { expense: 'a taxi' },
      });
      const runId = String(starting.structuredContent?.['run_id']);
      await session.callTool('send_run_event', {
        run_id: runId,
        event: { type: 'com.acme.approval.decided', data: 'yes' },
      });
      await settled(session, runId);
      return {
        history: await session.callTool('get_run_history', { run_id: runId, limit: 100 }),
        tree: await session.callTool('list_brain_events', { run_id: runId, order: 'asc', limit: 100 }),
      };
    });
    const { events } = eventsOf(history.structuredContent);
    const waiting = stepOf(events, 'step_waiting', 'judge');
    const childStarted = startOf(eventsOf(tree.structuredContent).events, waiting?.data.run_id);

    expect(events.filter(({ type }) => type.startsWith('step_')).length).toBeGreaterThan(0);
    expect(causesNamedNowhereIn(events)).toEqual([]);
    expect(childStarted?.causation_id).toBe(waiting?.id);
  });
});
