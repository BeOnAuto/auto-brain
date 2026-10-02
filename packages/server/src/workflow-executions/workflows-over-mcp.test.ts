import { setTimeout } from 'node:timers/promises';

import { listedTools, toolNamesIn, withMcpSession, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { answers, jsonResult, type ScriptedReply } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingInference, type InferenceServer } from '../testing/inference-server.ts';
import { servingWorkflows, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

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
      call: execute_spec
      with: { primitive: inference, name: verdict, input: { expense: '\${ .expense }' } }
      output:
        as: '\${ { approve: .approve } }'
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
      output:
        as: '\${ { decided: .[0] } }'
`,
);

const brainTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
  'send_execution_event',
];

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

function onAlphaOf<T>(served: InferenceServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${served.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

async function onAlpha<T>(replies: readonly ScriptedReply[], use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingWorkflows(replies);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return onAlphaOf(server, use);
}

async function settled(session: McpSession, executionId: string): Promise<ToolResult> {
  const reading = await session.callTool('get_execution', { execution_id: executionId });
  if (reading.structuredContent?.['status'] !== 'started') {
    return reading;
  }
  await setTimeout(100);
  return settled(session, executionId);
}

const primitiveField = Schema.decodeUnknownSync(
  Schema.Struct({ properties: Schema.Struct({ primitive: Schema.Struct({ enum: Schema.Array(Schema.String) }) }) }),
);

function primitivesOfCreateSpec(listing: unknown): readonly string[] {
  const createSpec = listedTools(listing).filter(({ name }) => name === 'create_spec');
  return createSpec.flatMap(({ inputSchema }) => primitiveField(inputSchema).properties.primitive.enum);
}

describe('a server that offers workflows, over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('lists eight tools on the endpoint of a brain, and both primitives in the spec tools', async () => {
    const listing = await onAlpha([], (session) => session.listTools());

    expect(toolNamesIn(listing)).toEqual(brainTools);
    expect(primitivesOfCreateSpec(listing)).toEqual(['inference', 'orchestration']);
  });

  it('executes a workflow that calls an inference spec and waits for an event the tools send', async () => {
    const { started, sent, execution } = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
      await session.callTool('create_spec', { primitive: 'inference', name: 'verdict', source: verdict });
      await session.callTool('create_spec', { primitive: 'orchestration', name: 'approval', source: approval });
      const starting = await session.callTool('execute_spec', {
        primitive: 'orchestration',
        name: 'approval',
        input: { expense: 'a taxi' },
      });
      const executionId = String(starting.structuredContent?.['execution_id']);
      const sending = await session.callTool('send_execution_event', {
        execution_id: executionId,
        event: { type: 'com.acme.approval.decided', data: 'yes' },
      });
      return { started: starting, sent: sending, execution: await settled(session, executionId) };
    });

    expect(started.structuredContent).toMatchObject({ primitive: 'orchestration', status: 'started' });
    expect(sent.structuredContent).toMatchObject({ event: { type: 'com.acme.approval.decided', data: 'yes' } });
    expect(execution.structuredContent).toMatchObject({ status: 'succeeded', output: { decided: 'yes' } });
  });
});

describe('a server that does not offer workflows, over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('lists seven tools on the endpoint of a brain, and only inference in the spec tools', async () => {
    server = await servingInference([]);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });

    const listing = await onAlphaOf(server, (session) => session.listTools());
    const creating = await server.call('POST', '/v1/orgs/acme/brains/alpha/specs/orchestration', {
      body: { name: 'approval', source: approval },
    });

    expect(toolNamesIn(listing)).toEqual(brainTools.filter((name) => name !== 'send_execution_event'));
    expect(primitivesOfCreateSpec(listing)).toEqual(['inference']);
    expect(creating).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });
});
