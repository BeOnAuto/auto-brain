import { withMcpSession, type McpSession, type ToolResult } from '@beonauto/api/testing';
import { campaignPace, campaignRows, scriptedPool } from '@beonauto/computation/testing';
import { jsonResult, textResult, type ScriptedReply } from '@beonauto/inference/testing';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import type { PoolOutcome } from '@beonauto/workflow-engine/dsl';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { workerPool, type ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, type ReasoningServer } from '../testing/reasoning-server.ts';
import {
  executionIdIn,
  servingWorkflows,
  settledExecution,
  workflowSource,
  workflowTestTimeoutMs,
} from '../testing/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const readRows = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'tools: [graph/echo]',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {rows: {type: array}}, required: [rows]}',
  '---',
  'Read the rows of the campaigns {{ input.campaigns }} from the graph.',
].join('\n');

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {total_spend_cents: {type: integer}}, required: [total_spend_cents]}',
  '---',
  'Write one sentence about a total spend of {{ input.total_spend_cents }} cents.',
].join('\n');

const raising = ['---', 'language: jq', '---', 'error("the period has not started")'].join('\n');

const shouting = ['---', 'language: jq', '---', 'error("x" * 30000000)'].join('\n');

const catching = workflowSource(
  'catching',
  `do:
  - compute:
      try:
        - shout:
            call: execute_spec
            with: { primitive: computation, name: shouting, input: '\${ . }' }
      catch:
        errors:
          with: { status: 409 }
        as: failure
        do:
          - caught:
              set:
                type: '\${ $failure.type }'
                kind: '\${ $failure.kind }'
                bytes: '\${ $failure.detail | utf8bytelength }'
`,
);

function report(name: string, computation: string): string {
  return workflowSource(
    name,
    `do:
  - read:
      call: execute_spec
      with: { primitive: inference, name: read-rows, input: { campaigns: '\${ .campaigns }' } }
      output:
        as: '\${ { rows: .rows, period: $input.period } }'
  - compute:
      try:
        - pace:
            call: execute_spec
            with: { primitive: computation, name: ${computation}, input: '\${ . }' }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: PT0.05S
          limit:
            attempt: { count: 2 }
  - write:
      call: execute_spec
      with: { primitive: inference, name: summary, input: { total_spend_cents: '\${ .total_spend_cents }' } }
`,
  );
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const rows = campaignRows(100);

function readingRowsThroughTheGraph(): ScriptedReply {
  return (request) =>
    Effect.promise(async (signal) => {
      const echo = request.tools?.offered.find(({ name }) => name === 'mcp__graph__echo');
      const reply = await echo?.call(
        { callId: 'call-1', input: { rows: rows['rows'] } },
        { signal, cancelled: signal },
      );
      return jsonResult(decodeJson(reply?.text ?? '{}'));
    });
}

const workflowInput = { campaigns: 'all', period: rows['period'] };

const closing: (() => Promise<void>)[] = [];

const graphs: FakeMcpServer[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(programPoolOf: ProgramPoolOf, ...replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  graphs.splice(0, graphs.length, graph);
  closing.push(graph.close);
  const server = await servingWorkflows(
    replies,
    {
      LOCAL_MODE: 'true',
      GRAPH_API_KEY: apiKey,
      MCP_SERVERS: JSON.stringify({
        graph: { url: graph.url, org: 'acme', headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
      }),
    },
    programPoolOf,
  );
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  const definitions = [
    ['inference', 'read-rows', readRows],
    ['inference', 'summary', summary],
    ['computation', 'pace', campaignPace],
    ['computation', 'raising', raising],
    ['orchestration', 'report', report('report', 'pace')],
    ['orchestration', 'stuck', report('stuck', 'raising')],
    ['computation', 'shouting', shouting],
    ['orchestration', 'catching', catching],
  ] as const;
  await definitions.reduce(
    (created: Promise<unknown>, [primitive, name, source]) =>
      created.then(() => server.call('POST', `${alpha}/specs/${primitive}`, { body: { name, source } })),
    Promise.resolve(),
  );
  return server;
}

async function settledRun(server: ReasoningServer, workflow: string) {
  const started = await server.call('POST', `${alpha}/specs/orchestration/${workflow}/execute`, {
    body: { input: workflowInput },
  });
  return settledExecution(server, `${alpha}/executions/${executionIdIn(started.body)}`);
}

async function computationRuns(server: ReasoningServer) {
  return (await server.call('GET', `${alpha}/executions?primitive=computation`)).body;
}

const decodeListing = Schema.decodeUnknownSync(
  Schema.Struct({ executions: Schema.Array(Schema.Struct({ execution_id: Schema.String })) }),
);

async function computedOutput(server: ReasoningServer): Promise<unknown> {
  const [run] = decodeListing(await computationRuns(server)).executions;
  const read = await server.call('GET', `${alpha}/executions/${run?.execution_id ?? ''}`);
  return Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Unknown }))(read.body).output;
}

function scripted(...outcomes: readonly PoolOutcome[]): ProgramPoolOf {
  return (settings) => scriptedPool(outcomes, workerPool(settings));
}

describe(
  'a workflow that reads rows through an MCP server, computes and reasons',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('turns the rows into exact totals with a computation function and has a reasoning function write the words', async () => {
      const server = await serving(workerPool, readingRowsThroughTheGraph(), () =>
        Effect.succeed(textResult('The campaigns spent 2,831.50 in all.')),
      );

      const settled = await settledRun(server, 'report');

      expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'The campaigns spent 2,831.50 in all.' } });
      expect(graphs[0]?.received()).toMatchObject([{ tool: 'echo', arguments: { rows: rows['rows'] } }]);
      expect(await computationRuns(server)).toMatchObject({
        executions: [{ primitive: 'computation', name: 'pace', status: 'succeeded' }],
      });
      expect(await computedOutput(server)).toMatchObject({ total_spend_cents: 283_150 });
      expect(server.modelCalls()).toBe(2);
    });

    it('retries the computation step after a transient failure, and runs it again', async () => {
      const server = await serving(
        scripted({ ran: 'stopped', because: 'busy', milliseconds: 10_000 }),
        readingRowsThroughTheGraph(),
        () => Effect.succeed(textResult('Spent.')),
      );

      const settled = await settledRun(server, 'report');

      expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Spent.' } });
      expect(await computationRuns(server)).toMatchObject({
        executions: [
          { name: 'pace', status: 'succeeded' },
          { name: 'pace', status: 'rejected', rejection: { reason: 'unavailable' } },
        ],
      });
    });

    it('does not retry a conflict, since the same input gives the same result, and the workflow ends', async () => {
      const server = await serving(workerPool, readingRowsThroughTheGraph());

      const settled = await settledRun(server, 'stuck');

      expect(settled).toMatchObject({ body: { status: 'rejected' } });
      expect(await computationRuns(server)).toMatchObject({
        executions: [{ name: 'raising', status: 'rejected', rejection: { reason: 'conflict', kind: 'unworkable' } }],
      });
      expect(server.modelCalls()).toBe(1);
    });
  },
);

async function settledOverMcp(session: McpSession, executionId: string): Promise<ToolResult> {
  const reading = await session.callTool('get_execution', { execution_id: executionId });
  return reading.structuredContent?.['status'] === 'started' ? settledOverMcp(session, executionId) : reading;
}

describe('a workflow whose computation function raises a long error', { timeout: workflowTestTimeoutMs }, () => {
  it('catches it as the runtime error of status 409 the format documents, its text cut at 1,024 bytes', async () => {
    const server = await serving(workerPool);

    const settled = await settledRun(server, 'catching');
    const caught = Schema.decodeUnknownSync(
      Schema.Struct({
        body: Schema.Struct({
          status: Schema.Literal('succeeded'),
          output: Schema.Struct({ type: Schema.String, kind: Schema.String, bytes: Schema.Number }),
        }),
      }),
    )(settled).body.output;

    expect(caught).toMatchObject({
      type: 'https://open-workflow-specification.org/spec/1.0.0/errors/runtime',
      kind: 'unworkable',
    });
    expect(caught.bytes).toBeLessThan(1100);
  });
});

describe('the same workflow over MCP', { timeout: workflowTestTimeoutMs }, () => {
  it('runs as it does over HTTP', async () => {
    const server = await serving(workerPool, readingRowsThroughTheGraph(), () =>
      Effect.succeed(textResult('The campaigns spent 2,831.50 in all.')),
    );

    const settled = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} },
      async (session) => {
        const started = await session.callTool('execute_spec', {
          primitive: 'orchestration',
          name: 'report',
          input: workflowInput,
        });
        return settledOverMcp(session, String(started.structuredContent?.['execution_id']));
      },
    );

    expect(settled.structuredContent).toMatchObject({
      status: 'succeeded',
      output: 'The campaigns spent 2,831.50 in all.',
    });
  });
});
