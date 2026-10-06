import {
  internalTermsIn,
  plainTextIn,
  technicalTextIn,
  toolNamesIn,
  withMcpSession,
  type McpSession,
  type ToolResult,
} from '@beonauto/api/testing';
import { createApiKey } from '@beonauto/identity';
import { ModelNotAllowed, ProviderNotConfigured, SpecInvalid } from '@beonauto/inference';
import { answers, textResult, type ScriptedReply } from '@beonauto/inference/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/reasoning-server.ts';
import { servingWorkflows, workflowSource, workflowTestTimeoutMs } from '../testing/workflow-server.ts';

type Called = readonly (readonly [string, ToolResult])[];

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const approval = workflowSource(
  'approval',
  `do:
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
`,
);

const unconnectedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const replies: readonly ScriptedReply[] = [
  answers(textResult('Profits rose.')),
  () =>
    Effect.fail(
      new ProviderNotConfigured({
        detail: 'anthropic is not configured; it needs ANTHROPIC_API_KEY',
        provider: 'anthropic',
        configured: [],
        missing: ['ANTHROPIC_API_KEY'],
      }),
    ),
  () =>
    Effect.fail(
      new SpecInvalid({
        detail: 'anthropic answered HTTP 400',
        provider: 'anthropic',
        status: 400,
        provider_message: 'temperature is not supported',
        issues: [],
      }),
    ),
];

const disallowedModel = new ModelNotAllowed({
  detail: 'anthropic/claude-sonnet-4-5 is not one of the models this server offers',
  provider: 'anthropic',
});

const switchable =
  'Nothing was changed. This can be put right on your side: once its prompt names one of the models this server can call, which list_models shows, it can be tried again.';

function executedOnce(): Promise<ToolResult> {
  const reasonFunction = { primitive: 'inference', name: 'summary' };
  return onMcp(async (session) => {
    await session.callTool('create_brain', { brain: 'sales', name: 'Sales' });
    await session.callTool('create_spec', inSales({ ...reasonFunction, source: summary }));
    return session.callTool('execute_spec', inSales({ ...reasonFunction, input: { text: 'the quarter' } }));
  });
}

const unofferedProvider = new ProviderNotConfigured({
  detail: 'anthropic is not configured. Configured providers: openai, gateway',
  provider: 'anthropic',
  configured: ['openai', 'gateway'],
  missing: ['ANTHROPIC_API_KEY'],
});

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(
  use: (session: McpSession) => Promise<T>,
  headers: Readonly<Record<string, string>> = {},
): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers }, use);
}

function inSales(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { brain: 'sales', ...input };
}

async function brainsCalled(session: McpSession): Promise<Called> {
  const describing = { brain: 'sales', name: 'Sales', description: 'Answers questions about the pipeline' };
  const created = await session.callTool('create_brain', describing);
  await session.callTool('create_brain', { brain: 'old-sales', name: 'Old sales' });
  return [
    ['create_brain', created],
    ['retire_brain', await session.callTool('retire_brain', { brain: 'old-sales' })],
    ['list_brains', await session.callTool('list_brains', { include_retired: true })],
    ['get_brain', await session.callTool('get_brain', { brain: 'sales' })],
    ['update_brain', await session.callTool('update_brain', { ...describing, description: 'Answers questions' })],
    ['list_models', await session.callTool('list_models', {})],
  ];
}

async function reasonFunctionsCalled(session: McpSession): Promise<Called> {
  const reasonFunction = { primitive: 'inference', name: 'summary' };
  const created = await session.callTool('create_spec', inSales({ ...reasonFunction, source: summary }));
  const executed = await session.callTool(
    'execute_spec',
    inSales({ ...reasonFunction, input: { text: 'the quarter' } }),
  );
  const executionId = String(executed.structuredContent?.['execution_id']);
  return [
    ['create_spec', created],
    ['list_specs', await session.callTool('list_specs', inSales({ primitive: 'inference' }))],
    ['get_spec', await session.callTool('get_spec', inSales(reasonFunction))],
    [
      'update_spec',
      await session.callTool(
        'update_spec',
        inSales({ ...reasonFunction, source: summary.replace('Summarize: ', 'Sum up: ') }),
      ),
    ],
    ['execute_spec', executed],
    ['get_execution', await session.callTool('get_execution', inSales({ execution_id: executionId }))],
    ['list_executions', await session.callTool('list_executions', inSales({}))],
    ['get_execution_history', await session.callTool('get_execution_history', inSales({ execution_id: executionId }))],
    ['list_brain_events', await session.callTool('list_brain_events', inSales({ limit: 3 }))],
    ['list_brain_events', await session.callTool('list_brain_events', { brain: 'old-sales' })],
    ['get_brain_analytics', await session.callTool('get_brain_analytics', inSales({ days: 30 }))],
  ];
}

async function workflowsCalled(session: McpSession): Promise<Called> {
  const workflow = { primitive: 'orchestration', name: 'approval' };
  await session.callTool('create_spec', inSales({ ...workflow, source: approval }));
  const started = await session.callTool('execute_spec', inSales(workflow));
  const executionId = String(started.structuredContent?.['execution_id']);
  const event = { type: 'com.acme.approval.decided', data: 'yes' };
  return [
    ['execute_spec', started],
    ['get_execution', await session.callTool('get_execution', inSales({ execution_id: executionId }))],
    [
      'send_execution_event',
      await session.callTool('send_execution_event', inSales({ execution_id: executionId, event })),
    ],
    ['retire_spec', await session.callTool('retire_spec', inSales(workflow))],
  ];
}

async function errorsCalled(session: McpSession): Promise<Called> {
  const run = (input: Readonly<Record<string, unknown>>) =>
    session.callTool('execute_spec', inSales({ primitive: 'inference', name: 'summary', ...input }));
  const broken = { primitive: 'inference', name: 'broken', source: '---\nmodel: [\n---\nHi' };
  const retired = { primitive: 'orchestration', name: 'approval', source: approval };
  return [
    ['an unconnected provider', await run({ input: { text: 'the quarter' }, execution_id: unconnectedRun })],
    ['a document the provider refuses', await run({ input: { text: 'the year' } })],
    ['an unexpected failure', await run({ input: { text: 'the decade' } })],
    ['input that does not fit', await run({ input: { text: 7 } })],
    ['a document that does not parse', await session.callTool('create_spec', inSales(broken))],
    ['a name already taken', await session.callTool('create_brain', { brain: 'sales', name: 'Sales again' })],
    ['a retired thing', await session.callTool('update_spec', inSales(retired))],
    [
      'a retired brain',
      await session.callTool('create_spec', {
        brain: 'old-sales',
        primitive: 'inference',
        name: 'summary',
        source: summary,
      }),
    ],
    ['something missing', await session.callTool('get_brain', { brain: 'nowhere' })],
    [
      'a run that did not go through',
      await session.callTool('get_execution', inSales({ execution_id: unconnectedRun })),
    ],
  ];
}

const referenceOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ instance: Schema.optionalKey(Schema.String) })),
);

function plainWordsBesideTheReference(result: ToolResult): string {
  const { instance } = referenceOf(technicalTextIn(result));
  const words = plainTextIn(result);
  return instance === undefined ? words : words.replace(instance.replace('urn:uuid:', ''), 'the reference');
}

function leaked([label, result]: readonly [string, ToolResult]): readonly (readonly [string, readonly string[]])[] {
  const terms = internalTermsIn(plainWordsBesideTheReference(result));
  return terms.length === 0 ? [] : [[label, terms]];
}

function audienceOf([label, result]: readonly [string, ToolResult]): readonly [string, boolean] {
  return [label, plainTextIn(result).includes(audienceWords[label] ?? 'no words for this label')];
}

const audienceWords: Readonly<Record<string, string>> = {
  'an unconnected provider': 'Only whoever runs the server can put this right',
  'a document the provider refuses': 'This can be corrected and tried again',
  'an unexpected failure': 'It was not caused by anything you did.',
  'input that does not fit': 'This can be corrected and tried again',
  'a document that does not parse': 'This can be corrected and tried again',
  'a name already taken': 'that name is already taken',
  'a retired thing': 'it has been retired',
  'a retired brain': 'it has been retired',
  'something missing': 'it, or something it refers to, could not be found',
  'a run that did not go through': 'did not go through: something the server relies on is not available',
};

describe('the plain words that lead each result over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('lead every tool’s success and every kind of error, name no internal term, and come before the details', async () => {
    server = await servingWorkflows(replies);

    const { tools, successes, errors } = await onMcp(async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      successes: [
        ...(await brainsCalled(session)),
        ...(await reasonFunctionsCalled(session)),
        ...(await workflowsCalled(session)),
      ],
      errors: await errorsCalled(session),
    }));

    expect(new Set(successes.map(([name]) => name))).toEqual(new Set(tools));
    expect(successes.filter(([, result]) => result.isError === true)).toEqual([]);
    expect(errors.map((called) => audienceOf(called))).toEqual(errors.map(([label]) => [label, true]));
    expect([...successes, ...errors].flatMap((called) => leaked(called))).toEqual([]);
    expect([...successes, ...errors].map(([, result]) => result.content.length)).toEqual(
      [...successes, ...errors].map(() => 2),
    );
  });

  it('say plainly that a connection is not allowed to do what it asked', async () => {
    const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' });
    server = await servingReasoning([], { API_KEYS: JSON.stringify([reader.entry]) });

    const refused = await onMcp((session) => session.callTool('create_brain', { brain: 'sales', name: 'Sales' }), {
      authorization: `Bearer ${reader.key}`,
    });

    expect(plainTextIn(refused)).toBe(
      'Could not create the brain “sales”: this connection is not allowed to do that. Nothing was changed. Whoever set up this connection can allow it.',
    );
  });
});

describe('the plain words for a reasoning function whose prompt names a model the server does not offer', () => {
  it('say that its provider is not set up while others are, and that it can be switched to a model the server lists', async () => {
    server = await servingReasoning([() => Effect.fail(unofferedProvider)]);

    const unoffered = await executedOnce();

    expect(plainTextIn(unoffered)).toBe(
      `Could not run the reasoning function “summary”: this server does not offer the model named, because its provider is not set up on this server, though others are. ${switchable}`,
    );
    expect(internalTermsIn(plainTextIn(unoffered))).toEqual([]);
    expect(technicalTextIn(unoffered)).toContain('Configured providers: openai, gateway');
  });

  it('say that it is outside the models whoever runs the server allows, and that it can be switched', async () => {
    server = await servingReasoning([() => Effect.fail(disallowedModel)]);

    const disallowed = await executedOnce();

    expect(plainTextIn(disallowed)).toBe(
      `Could not run the reasoning function “summary”: this server does not offer the model named, because it is not among the models whoever runs the server allows. ${switchable}`,
    );
    expect(internalTermsIn(plainTextIn(disallowed))).toEqual([]);
    expect(technicalTextIn(disallowed)).toContain('is not one of the models this server offers');
    expect(technicalTextIn(disallowed)).not.toContain('gateway/*');
  });
});
