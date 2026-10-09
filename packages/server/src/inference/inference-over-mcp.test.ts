import {
  danglingReferencesIn,
  guideToolName,
  listedTools,
  problemIn,
  textOf,
  withMcpSession,
  type McpSession,
} from '@beonauto/api/testing';
import { answers, textResult, type ScriptedReply } from '@beonauto/inference/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

const specTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
  'cancel_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
  'list_brain_events',
  'publish_event',
  'list_tool_servers',
  'test_tool_call',
  'answer_interaction',
  'list_interactions',
  'send_execution_event',
];

const withAnthropicThroughGateway = {
  LOCAL_MODE: 'true',
  MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
  MODEL_ALIASES: JSON.stringify({ 'anthropic/*': 'gateway/anthropic/*' }),
};

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function onAlpha<T>(replies: readonly ScriptedReply[], use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingReasoning(replies);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession('current revision', { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

describe('a reasoning function definition over MCP, on the endpoint of its brain', () => {
  it('is created, executed and read back with its execution', async () => {
    const { created, executed, execution } = await onAlpha([answers(textResult('Profits rose.'))], async (session) => {
      const creating = await session.callTool('create_spec', {
        primitive: 'inference',
        name: 'summary',
        source: summary,
      });
      const executing = await session.callTool('execute_spec', {
        primitive: 'inference',
        name: 'summary',
        input: { text: 'the quarter' },
      });
      const reading = await session.callTool('get_execution', {
        execution_id: String(executing.structuredContent?.['execution_id']),
      });
      return { created: creating, executed: executing, execution: reading };
    });

    expect(created.structuredContent).toMatchObject({ primitive: 'inference', name: 'summary', version: 1 });
    expect(executed.structuredContent).toMatchObject({ status: 'succeeded', output: 'Profits rose.' });
    expect(execution.structuredContent).toMatchObject({
      status: 'succeeded',
      output: 'Profits rose.',
      record: { prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter', truncated: false } },
    });
    expect(server.modelCalls()).toBe(1);
  });

  it('answers an input the spec rejects with isError and the problem document', async () => {
    const executed = await onAlpha([], async (session) => {
      await session.callTool('create_spec', { primitive: 'inference', name: 'summary', source: summary });
      return session.callTool('execute_spec', { primitive: 'inference', name: 'summary', input: { text: 7 } });
    });

    expect({ isError: executed.isError, problem: problemIn(executed) }).toMatchObject({
      isError: true,
      problem: {
        status: 422,
        reason: 'invalid_input',
        errors: [{ pointer: '/input/text', detail: 'Expected string' }],
      },
    });
    expect(server.modelCalls()).toBe(0);
  });
});

describe('the spec tools an agent sees on the endpoint of a brain', () => {
  it('are the eighteen operations inside a brain and the guide tool, none of them carrying the format of a document', async () => {
    const tools = listedTools(await onAlpha([], (session) => session.listTools()));

    expect(tools.map(({ name }) => name)).toEqual([...specTools, guideToolName]);
    expect(tools.filter(({ description = '' }) => description.includes('Front matter'))).toEqual([]);
  });

  it('send an agent to the guide that ends with the providers and named models the server calls', async () => {
    server = await servingReasoning([], withAnthropicThroughGateway);
    const guide = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, (session) =>
      session.callTool(guideToolName, { guide: 'reasoning-function' }),
    );

    expect(textOf(guide)).toMatch(
      /On this server, a reasoning function names its model through gateway, written gateway\/<model id>, or one of the models its operator named: anthropic\/\*, where a name that ends in \* stands for any model id, so anthropic\/<model id> runs; no tool server is configured, so it may name no tools\.\n$/u,
    );
  });

  it('have self-contained input schemas with an object root', async () => {
    const tools = listedTools(await onAlpha([], (session) => session.listTools()));
    const schemas = tools.map(({ inputSchema }) => inputSchema);

    expect(schemas).toHaveLength(19);
    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
  });
});
