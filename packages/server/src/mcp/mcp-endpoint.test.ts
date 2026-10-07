import { readFileSync } from 'node:fs';

import { instructionsFor, type McpEndpoint } from '@beonauto/api';
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

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const brainTools = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

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
  'answer_interaction',
  'list_interactions',
  'send_execution_event',
];

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

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
    server = await servingReasoning([]);

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
    server = await servingReasoning([]);
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
});

const orgTools = [...brainTools, 'list_models'];

const definitionTypes = [
  { primitive: 'inference', noun: 'reasoning function' },
  { primitive: 'interaction', noun: 'interaction function' },
  { primitive: 'computation', noun: 'computation function' },
  { primitive: 'recollection', noun: 'recall function' },
  { primitive: 'orchestration', noun: 'workflow' },
];

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

const resourcesOnTheTerminologyPage: ReadonlySet<string> = new Set(
  [...terminology.matchAll(/^\| \w+ +\| ([A-Z][a-z]+(?: function)?) +\| /gmu)].map(
    ([, resource = '']: readonly string[]) => resource.toLowerCase(),
  ),
);

interface Connection {
  readonly path: string;
  readonly endpoint: McpEndpoint;
  readonly served: { readonly orgTools: readonly string[]; readonly brainTools: readonly string[] };
  readonly sentence: string;
  readonly unnamed: readonly string[];
}

const connections: readonly Connection[] = [
  {
    path: '/mcp',
    endpoint: 'own org',
    served: { orgTools, brainTools: specTools },
    sentence: "This connection acts in the caller's own org.",
    unnamed: [],
  },
  {
    path: '/orgs/acme/mcp',
    endpoint: 'org',
    served: { orgTools, brainTools: [] },
    sentence: 'This connection manages the brains of one org.',
    unnamed: [
      'create_spec',
      'execute_spec',
      'get_execution',
      'list_tool_servers',
      'answer_interaction',
      'send_execution_event',
    ],
  },
  {
    path: '/orgs/acme/brains/alpha/mcp',
    endpoint: 'brain',
    served: { orgTools: [], brainTools: specTools },
    sentence: 'This connection acts inside one brain.',
    unnamed: ['create_brain', 'list_brains', 'list_models'],
  },
];

describe('the instructions an agent receives when it connects', () => {
  it.each(connections)(
    'on $path say what a brain, a definition and a run are, and name only the tools the endpoint serves',
    async ({ path, endpoint, served, sentence, unnamed }) => {
      server = await servingReasoning([]);
      await onMcp('/mcp', (session) => session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }));

      const instructions = await onMcp(path, (session) => Promise.resolve(session.instructions));

      expect(instructions).toBe(instructionsFor(endpoint, served, definitionTypes));
      expect(instructions).toContain(sentence);
      expect(unnamed.filter((name) => instructions?.includes(name) === true)).toEqual([]);
    },
  );

  it('name each definition type the server serves by the kind the terminology page gives it', async () => {
    server = await servingReasoning([]);

    const instructions = await onMcp('/mcp', (session) => Promise.resolve(session.instructions));

    expect(
      definitionTypes.filter(({ noun }: Readonly<{ noun: string }>) => !resourcesOnTheTerminologyPage.has(noun)),
    ).toEqual([]);
    expect(instructions).toContain(
      'inference for a reasoning function, interaction for an interaction function, computation for a computation function, recollection for a recall function or orchestration for a workflow;',
    );
  });
});

function reachingOutside(tools: readonly ListedTool[]): readonly string[] {
  return tools.filter(({ annotations }) => annotations?.['openWorldHint'] === true).map(({ name }) => name);
}

describe('the open-world hint of the tools of /mcp', () => {
  it('is set for list_models and execute_spec, which reach model providers, for list_tool_servers, which reaches tool servers, and for no other tool', async () => {
    server = await servingReasoning([]);

    expect(reachingOutside(await listingOn('/mcp'))).toEqual(['list_models', 'execute_spec', 'list_tool_servers']);
  });
});

describe('one connection to /mcp', () => {
  it('creates a brain, then creates, executes and reads back a reasoning function definition in it', async () => {
    server = await servingReasoning([answers(textResult('Profits rose.'))]);

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
    server = await servingReasoning([]);

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
    server = await servingReasoning([]);

    await onMcp('/mcp', (session) => session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }));
    const listed = await server.call('GET', '/v1/orgs/local/brains');

    expect(listed.body).toMatchObject({ brains: [{ id: 'alpha', created_by: 'local' }] });
  });
});
