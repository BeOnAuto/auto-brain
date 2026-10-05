import {
  danglingReferencesIn,
  listedTools,
  problemIn,
  takingBrain,
  withMcpSession,
  type ListedTool,
  type McpSession,
} from '@beonauto/api/testing';
import { answers, textResult } from '@beonauto/inference/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingInference, type InferenceServer } from '../testing/inference-server.ts';

const brainTools = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const specTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
];

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

let server: InferenceServer;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, use);
}

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return onMcp(path, async (session) => listedTools(await session.listTools()));
}

const brainArgumentIn = Schema.decodeUnknownSync(
  Schema.Struct({
    required: Schema.Array(Schema.String),
    properties: Schema.Struct({ brain: Schema.Struct({ type: Schema.String, pattern: Schema.String }) }),
  }),
);

describe('the brain argument of the spec tools on /mcp', () => {
  it('is required in every one of them, as a string with the brain id pattern', async () => {
    server = await servingInference([]);

    const spec = (await listingOn('/mcp')).filter(({ name }) => specTools.includes(name));
    const brainArguments = spec.map(({ inputSchema }) => {
      const { required, properties } = brainArgumentIn(inputSchema);
      const { type, pattern } = properties.brain;
      return { required: required.includes('brain'), type, pattern };
    });

    expect(brainArguments).toEqual(
      specTools.map(() => ({ required: true, type: 'string', pattern: '^[a-z][a-z0-9-]{2,47}$' })),
    );
  });
});

describe('the tools of /mcp', () => {
  it('are the brain tools, list_models and the spec tools, the spec tools taking a brain, with self-contained schemas', async () => {
    server = await servingInference([]);
    await server.call('POST', '/v1/orgs/local/brains', { body: { brain: 'alpha', name: 'Alpha' } });

    const [own, org, brain] = [
      await listingOn('/mcp'),
      await listingOn('/orgs/local/mcp'),
      await listingOn('/orgs/local/brains/alpha/mcp'),
    ];
    const schemas = own.flatMap(({ inputSchema, outputSchema }) => [inputSchema, outputSchema]);

    expect(own.map(({ name }) => name)).toEqual([...brainTools, 'list_models', ...specTools]);
    expect(own).toEqual([...org, ...brain.map((tool) => takingBrain(tool))]);
    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
  });

  it('carry instructions about brains, specs and executions, and nothing about workflows', async () => {
    server = await servingInference([]);

    const instructions = await onMcp('/mcp', (session) => Promise.resolve(session.instructions));

    expect(instructions).toBe(
      [
        'This server runs the business brains of your org.',
        'Start with list_brains to see them, or create_brain to make one.',
        'A brain works through specs: named, versioned documents, each written for one primitive, a kind of work the brain can do.',
        "The spec tools take the primitive by name, and their descriptions explain how each primitive's document is written.",
        'list_models lists the models this server can call.',
        'execute_spec runs a spec and records the run as an execution.',
        'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
        "Every tool that works inside a brain takes the brain's id as brain.",
        'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
      ].join(' '),
    );
  });
});

describe('one connection to /mcp', () => {
  it('creates a brain, then creates, executes and reads back an inference spec in it', async () => {
    server = await servingInference([answers(textResult('Profits rose.'))]);

    const outcome = await onMcp('/mcp', async (session) => {
      const brain = await session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' });
      const spec = await session.callTool('create_spec', {
        brain: 'alpha',
        primitive: 'inference',
        name: 'summary',
        source: summary,
      });
      const executed = await session.callTool('execute_spec', {
        brain: 'alpha',
        primitive: 'inference',
        name: 'summary',
        input: { text: 'the quarter' },
      });
      const execution = await session.callTool('get_execution', {
        brain: 'alpha',
        execution_id: String(executed.structuredContent?.['execution_id']),
      });
      return { brain, spec, executed, execution };
    });

    expect(outcome.brain.structuredContent).toMatchObject({ id: 'alpha', status: 'active' });
    expect(outcome.spec.structuredContent).toMatchObject({ primitive: 'inference', name: 'summary', version: 1 });
    expect(outcome.executed.structuredContent).toMatchObject({ status: 'succeeded', output: 'Profits rose.' });
    expect(outcome.execution.structuredContent).toMatchObject({
      execution_id: outcome.executed.structuredContent?.['execution_id'],
      status: 'succeeded',
      output: 'Profits rose.',
      record: { prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter' } },
    });
    expect(server.modelCalls()).toBe(1);
  });
});

describe('a spec tool on /mcp', () => {
  it('answers a call without a brain, and with an unknown brain, as isError', async () => {
    server = await servingInference([]);

    const outcome = await onMcp('/mcp', async (session) => ({
      without: await session.callTool('list_specs', { primitive: 'inference' }),
      unknown: await session.callTool('list_specs', { brain: 'nowhere', primitive: 'inference' }),
    }));

    expect(problemIn(outcome.without)).toMatchObject({
      reason: 'invalid_input',
      errors: [{ detail: 'Missing key', pointer: '/brain' }],
    });
    expect(problemIn(outcome.unknown)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
  });
});

describe('/mcp in local mode', () => {
  it('acts in the org local, whose brains the HTTP API lists', async () => {
    server = await servingInference([]);

    await onMcp('/mcp', (session) => session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }));
    const listed = await server.call('GET', '/v1/orgs/local/brains');

    expect(listed.body).toMatchObject({ brains: [{ id: 'alpha', created_by: 'local' }] });
  });
});
