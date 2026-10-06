import { danglingReferencesIn, listedTools, problemIn, withMcpSession, type McpSession } from '@beonauto/api/testing';
import { makeReasoningFunctionAdapter } from '@beonauto/inference';
import { answers, scriptedLanguageModel, textResult, type ScriptedReply } from '@beonauto/inference/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';

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
  'list_executions',
  'get_execution_history',
  'list_brain_events',
  'send_execution_event',
];

const inferenceDescription = makeReasoningFunctionAdapter({
  languageModel: scriptedLanguageModel().languageModel,
  offered: { providers: [], aliases: [] },
}).description;

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
  it('are the eleven operations inside a brain, and those that name a primitive describe the document format of inference', async () => {
    const tools = listedTools(await onAlpha([], (session) => session.listTools()));
    const describing = tools.filter(({ description }) => description?.includes(inferenceDescription) === true);

    expect(tools.map(({ name }) => name)).toEqual(specTools);
    expect(describing.map(({ name }) => name)).toEqual(specTools.slice(0, 6));
  });

  it('tell an agent which providers and named models the server calls, before it writes a spec', async () => {
    server = await servingReasoning([], withAnthropicThroughGateway);
    const tools = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, (session) =>
      session.listTools(),
    );
    const createSpec = listedTools(tools).find(({ name }) => name === 'create_spec');

    expect(createSpec?.description).toContain(
      'This server calls models through gateway: write model as <provider>/<model id>, with a model id that provider serves, for example gateway/<model id>. Its operator also named these models, which a reasoning function may give as its model: anthropic/*. In a name that ends in *, the * stands for any model id, so a reasoning function may give anthropic/<model id>.',
    );
  });

  it('have self-contained input and output schemas with an object root', async () => {
    const tools = listedTools(await onAlpha([], (session) => session.listTools()));
    const schemas = tools.flatMap(({ inputSchema, outputSchema }) => [inputSchema, outputSchema]);

    expect(schemas).toHaveLength(22);
    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
  });
});
