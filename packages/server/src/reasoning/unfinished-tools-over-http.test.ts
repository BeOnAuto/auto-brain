import { setTimeout } from 'node:timers/promises';

import { serveFakeMcp, type FakeHints } from '@beonauto/mcp/testing';
import { TimedOut, ToolsStopped, type ToolsStoppedBecause } from '@beonauto/reasoning';
import { answers, callingTools, textResult, type ScriptedCall, type ScriptedReply } from '@beonauto/reasoning/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/*]', '---', 'Summarize acme.'].join('\n');

const stoppedBy =
  (because: ToolsStoppedBecause): ScriptedReply =>
  () =>
    Effect.fail(new ToolsStopped({ detail: 'The run stopped', provider: 'anthropic', because }));

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const searched: ScriptedCall = ['mcp__graph__search', { query: 'acme' }];

const echoed: ScriptedCall = ['mcp__graph__echo', { said: 'acme' }];

const broken = [1, 2, 3, 4, 5].map((attempt): ScriptedCall => ['mcp__graph__broken', { attempt }]);

async function serving(replies: readonly ScriptedReply[], hints: FakeHints = {}): Promise<ReasoningServer> {
  const fake = await serveFakeMcp({ bearer: apiKey, hints });
  onTestFinished(fake.close);
  const server = await servingReasoning(replies, {
    LOCAL_MODE: 'true',
    GRAPH_API_KEY: apiKey,
    MCP_SERVERS: JSON.stringify({
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source } });
  return server;
}

async function endedTwice(reply: ScriptedReply, hints?: FakeHints) {
  const server = await serving([reply], hints);
  const running = { body: { input: {}, run_id: runId } };
  const first = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, running);
  const again = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, running);
  return [first.status, first.body, again.status];
}

function endedAs(status: number, kind: string, because: string): readonly unknown[] {
  return [status, expect.objectContaining({ kind, because }), 409];
}

describe('a reasoning run that called only tools that read and could not finish, over HTTP', () => {
  it.each([
    ['five server failures', callingTools(broken, stoppedBy('server_failed')), 'server_failed'],
    ['its run bound', callingTools([searched], stoppedBy('run_bound')), 'run_bound'],
    ['a model that stopped answering', callingTools([searched], timedOut), 'model_unavailable'],
    ['a final step that still called tools', callingTools([searched], stoppedBy('no_answer')), 'no_answer'],
  ])('is tools_unfinished, 503, after %s, and tools_called under its id', async (_case, reply, because) => {
    expect(await endedTwice(reply)).toEqual(endedAs(503, 'tools_unfinished', because));
  });
});

async function untilCalled(calledAny: () => boolean): Promise<void> {
  if (!calledAny()) {
    await setTimeout(10);
    await untilCalled(calledAny);
  }
}

const unanswered: ScriptedReply = (request) =>
  Effect.promise(async () => {
    const sleeping = request.tools?.offered.find(({ name }) => name === 'mcp__graph__sleep');
    void sleeping?.call(
      { callId: 'call-1', input: { ms: 5000 } },
      { signal: AbortSignal.timeout(10_000), cancelled: new AbortController().signal },
    );
    await untilCalled(() => request.tools?.calledAny() !== false);
  }).pipe(Effect.andThen(stoppedBy('run_bound')(request)));

const mayChange: ReadonlyArray<readonly [string, ScriptedReply, string, FakeHints]> = [
  ['before the tools that read', callingTools([echoed, searched], timedOut), 'model_unavailable', {}],
  ['after the tools that read', callingTools([searched, echoed], stoppedBy('no_answer')), 'no_answer', {}],
  [
    'whose servers then kept failing',
    callingTools([echoed, ...broken], stoppedBy('server_failed')),
    'server_failed',
    {},
  ],
  ['and is still waiting for it', unanswered, 'run_bound', { sleep: { idempotentHint: true } }],
];

describe('a reasoning run that called a tool that may change something and could not finish, over HTTP', () => {
  it.each(mayChange)(
    'is effect_unknown, 409, when it called one %s, and tools_called under its id',
    async (_case, reply, because, hints) => {
      expect(await endedTwice(reply, hints)).toEqual(endedAs(409, 'effect_unknown', because));
    },
  );

  it('ends as before when it called no tool', async () => {
    const [status, body] = await endedTwice(timedOut);

    expect(status).toBe(503);
    expect(body).not.toHaveProperty('kind');
  });
});

const retryingOn503 = workflowSource(
  'reviewing',
  `do:
  - review:
      try:
        - summarize: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: PT0.01S
          limit:
            attempt: { count: 3 }
`,
);

async function reviewed(replies: readonly ScriptedReply[]) {
  const server = await serving(replies);
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'reviewing', source: retryingOn503 } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/reviewing/run`, { body: { input: {} } });
  const ended = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  return { ended: ended.body, modelCalls: server.modelCalls() };
}

describe(
  'a workflow whose reasoning step called tools and could not finish',
  { timeout: workflowTestTimeoutMs },
  () => {
    it('never retries on status 503 a step whose tool may have changed something, raised at 409 under its own type', async () => {
      expect(await reviewed([callingTools([echoed], timedOut)])).toMatchObject({
        ended: {
          status: 'rejected',
          rejection: { reason: 'conflict', kind: 'effect_unknown', because: 'model_unavailable' },
        },
        modelCalls: 1,
      });
    });

    it('retries on status 503 a step whose tools only read', async () => {
      const unfinished = callingTools([searched], timedOut);

      expect(await reviewed([unfinished, unfinished, answers(textResult('Acme has 2 rows.'))])).toMatchObject({
        ended: { status: 'succeeded', output: 'Acme has 2 rows.' },
        modelCalls: 3,
      });
    });
  },
);
