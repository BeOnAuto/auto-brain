import { listedTools, plainTextIn, withMcpSession, type McpSession } from '@beonauto/api/testing';
import { TimedOut } from '@beonauto/inference';
import { answers, callingTools, textResult, type ScriptedReply } from '@beonauto/inference/testing';
import { serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingInference, type InferenceServer } from '../testing/inference-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/search]', '---', 'Summarize acme.'].join(
  '\n',
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

async function serving(fake: FakeMcpServer | undefined, replies: readonly ScriptedReply[]): Promise<InferenceServer> {
  const servers =
    fake === undefined
      ? {}
      : {
          MCP_SERVERS: JSON.stringify({
            graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
          }),
        };
  const server = await servingInference(replies, { LOCAL_MODE: 'true', GRAPH_API_KEY: apiKey, ...servers });
  closing.push(server.stop);
  return server;
}

async function fakeGraph(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function onAlpha<T>(server: InferenceServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/orgs/acme/brains/alpha/mcp`, headers: {} }, use);
}

async function withBrain(server: InferenceServer): Promise<void> {
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_brain', { brain: 'alpha', name: 'Alpha' }),
  );
}

async function executedTwice(server: InferenceServer) {
  await withBrain(server);
  return onAlpha(server, async (session) => {
    await session.callTool('create_spec', { primitive: 'inference', name: 'summary', source });
    const running = { primitive: 'inference', name: 'summary', input: {}, execution_id: executionId };
    const first = await session.callTool('execute_spec', running);
    const again = await session.callTool('execute_spec', running);
    const history = await session.callTool('get_execution_history', { execution_id: executionId });
    return { first, again, history };
  });
}

async function annotationsOf(server: InferenceServer) {
  const listed = listedTools(await onAlpha(server, (session) => session.listTools()));
  return listed.find(({ name }) => name === 'execute_spec')?.annotations;
}

const searched = callingTools([['mcp__graph__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));

describe('execute_spec over MCP on a server with MCP servers', () => {
  it('is destructive when an MCP server is configured, so an assistant asks before running a function', async () => {
    const configured = await serving(await fakeGraph(), []);
    const unconfigured = await serving(undefined, []);

    expect(await annotationsOf(configured)).toMatchObject({ destructiveHint: true, openWorldHint: true });
    expect(await annotationsOf(unconfigured)).toMatchObject({ destructiveHint: false });
  });

  it('runs a reason function with its tools, whose history shows the calls', async () => {
    const fake = await fakeGraph();
    const { first, history } = await executedTwice(await serving(fake, [searched]));

    expect(first.structuredContent).toMatchObject({ status: 'succeeded', output: 'Acme has 2 rows.' });
    expect(history.structuredContent).toMatchObject({
      events: [
        { type: 'execution_started' },
        { type: 'tool_call_started', data: { server: 'graph', tool: 'search' } },
        { type: 'tool_call_answered', data: { outcome: 'result' } },
        { type: 'execution_succeeded' },
      ],
    });
  });

  it('says in plain words that a run that called tools may have changed something, and is not run again', async () => {
    const fake = await fakeGraph();
    const { first, again } = await executedTwice(
      await serving(fake, [callingTools([['mcp__graph__search', { query: 'acme' }]], timedOut)]),
    );

    expect(plainTextIn(first)).toBe(
      'Could not run the reason function “summary”: it called tools but could not finish, because the model stopped answering. What it called may have changed something, so it is not run again by itself: check what its history shows it called, then start a new run if it is still needed.',
    );
    expect(plainTextIn(again)).toMatch(
      /^Could not run the reason function “summary”: an earlier attempt of this run called tools and did not succeed/u,
    );
    expect(fake.received()).toHaveLength(1);
  });
});
