import { serveFakeMcp } from '@beonauto/mcp/testing';
import { textResult, type ScriptedReply } from '@beonauto/reasoning/testing';
import { Effect, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const answeringWhatItSaw: ScriptedReply = (request) =>
  Effect.promise((signal) => {
    const offered = Option.getOrThrow(Option.fromNullishOr(request.tools?.offered[0]));
    return offered.call({ callId: 'call-1', input: {} }, { signal, cancelled: signal });
  }).pipe(Effect.map(({ text }) => textResult(text)));

const profiling = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/profile]', '---', 'Profile acme.'].join(
  '\n',
);

describe('what a test of a tool answers', () => {
  it('is the text the model of a run of a function that names the same tool sees of its answer', async () => {
    const graph = await serveFakeMcp({ bearer: apiKey });
    closing.push(graph.close);
    const server = await servingReasoning([answeringWhatItSaw], {
      LOCAL_MODE: 'true',
      GRAPH_API_KEY: apiKey,
      MCP_SERVERS: JSON.stringify({
        graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
    });
    closing.push(server.stop);
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'profile', source: profiling } });

    const ran = await server.call('POST', `${alpha}/definitions/reasoning/profile/run`, { body: { input: {} } });
    const tested = await server.call('POST', `${alpha}/tool-servers/graph/tools/profile/test`, { body: {} });

    expect(ran).toMatchObject({ status: 200, body: { status: 'succeeded', output: '{"name":"Ada","rows":2}' } });
    expect(tested).toMatchObject({ status: 200, body: { outcome: 'result', text: '{"name":"Ada","rows":2}' } });
    expect(graph.received().map(({ tool }) => tool)).toEqual(['profile', 'profile']);
  });
});
