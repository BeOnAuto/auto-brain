import {
  internalTermsIn,
  listedTools,
  mcpClientKinds,
  plainTextIn,
  technicalTextIn,
  withMcpSession,
  type ListedTool,
  type ToolResult,
} from '@beonauto/api/testing';
import { answers, textResult } from '@beonauto/reasoning/testing';
import { Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning(mcpClientKinds.map(() => answers(textResult('Profits rose.'))));
  await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
    await session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' });
    await session.callTool('create_definition', {
      brain: 'alpha',
      type: 'reasoning',
      name: 'summary',
      source: summary,
    });
  });
});

afterAll(async () => {
  await server.stop();
});

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, async (session) =>
    listedTools(await session.listTools()),
  );
}

interface ListingOnTheWire {
  readonly status: number;
  readonly bytes: number;
  readonly toolCount: number | undefined;
}

const listingMessageOf = Schema.decodeUnknownOption(
  Schema.Struct({ result: Schema.Struct({ tools: Schema.Array(Schema.Unknown) }) }),
);

function toolCountIn(body: string): number | undefined {
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  const message: unknown = data === undefined ? undefined : JSON.parse(data.slice('data: '.length));
  return Option.getOrUndefined(Option.map(listingMessageOf(message), ({ result }) => result.tools.length));
}

async function listingOnTheWire(path: string): Promise<ListingOnTheWire> {
  const answer = await fetch(`${server.origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await answer.text();
  return { status: answer.status, bytes: Buffer.byteLength(body), toolCount: toolCountIn(body) };
}

interface Endpoint {
  readonly path: string;
  readonly tools: number;
  readonly mostBytes: number;
}

const endpoints: readonly Endpoint[] = [
  { path: '/mcp', tools: 26, mostBytes: 40_000 },
  { path: '/orgs/local/mcp', tools: 8, mostBytes: 9000 },
  { path: '/orgs/local/brains/alpha/mcp', tools: 20, mostBytes: 32_000 },
];

describe('the tools of each endpoint', () => {
  it.each(endpoints)(
    'on $path each carry an input schema with an object root and no output schema',
    async ({ path, tools }) => {
      const listed = await listingOn(path);

      expect(listed.map(({ inputSchema }) => inputSchema['type'])).toEqual(
        Array.from({ length: tools }, () => 'object'),
      );
      expect(listed.filter(({ outputSchema }) => outputSchema !== undefined).map(({ name }) => name)).toEqual([]);
    },
  );
});

describe('the listing of each endpoint', () => {
  it.each(endpoints)(
    'on $path answers 200 with its $tools tools in at most $mostBytes bytes on the wire',
    async ({ path, tools, mostBytes }) => {
      const { status, bytes, toolCount } = await listingOnTheWire(path);

      expect({ status, toolCount }).toEqual({ status: 200, toolCount: tools });
      expect(bytes).toBeLessThanOrEqual(mostBytes);
    },
  );
});

function outputIn(result: ToolResult): unknown {
  const output: unknown = JSON.parse(technicalTextIn(result));
  return output;
}

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists the tools, then accepts the results of list_tool_servers, list_brains and run_definition without compiling an output validator', async () => {
    const outcome = await withMcpSession(kind, { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
      await session.listTools();
      const results = [
        await session.callTool('list_tool_servers', {}),
        await session.callTool('list_brains', {}),
        await session.callTool('run_definition', {
          brain: 'alpha',
          type: 'reasoning',
          name: 'summary',
          input: { text: 'the quarter' },
        }),
      ];
      return { results, compiled: session.compiledOutputSchemas() };
    });

    expect(outcome.compiled).toEqual([]);
    expect(outcome.results.map((result) => plainTextIn(result))).toEqual([
      'Whoever runs this server has set up no tool server for this org, so the functions of its brains can call no tools until they set one up; the give-tools guide says what they need.',
      'There is 1 brain: “Alpha”.',
      'Ran the reasoning function “summary”. Its answer: “Profits rose.”',
    ]);
    expect(outcome.results.flatMap((result) => internalTermsIn(plainTextIn(result)))).toEqual([]);
    expect(outcome.results.map(({ structuredContent }) => structuredContent)).toMatchObject([
      { tool_servers: [] },
      { brains: [{ id: 'alpha' }] },
      { status: 'succeeded', output: 'Profits rose.' },
    ]);
    expect(outcome.results.map((result) => [result.content.length, outputIn(result)])).toEqual(
      outcome.results.map(({ structuredContent }) => [2, structuredContent]),
    );
  });
});
