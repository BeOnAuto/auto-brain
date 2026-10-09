import { reportingAccess, serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { makeReasoningFunctionAdapter } from '../capability/reasoning-function.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { callingTools } from '../testing/calling-tools.ts';
import { documentOf, issuesIn } from '../testing/definition-documents.ts';
import { textResult } from '../testing/model-results.ts';
import { runContext, reasoningWith, reasoningWithTools } from '../testing/reasoning-runs.ts';
import { answers } from '../testing/scripted-language-model.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function graphServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(fake: FakeMcpServer, org = 'acme') {
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  return access;
}

const naming = (...tools: readonly string[]) =>
  documentOf(`model: anthropic/claude-sonnet-4-5\ntools: [${tools.join(', ')}]`, 'Summarize acme.');

describe('the tools key of a reasoning function', () => {
  it('takes server/tool and server/*, each once', () => {
    expect(issuesIn(naming('graph/search', 'graph/*'))).toEqual([]);
    expect(issuesIn(naming('graph', 'graph/search', 'graph/search'))).toEqual([
      expect.stringMatching(/^Line 3, \/tools\/0: Expected server\/tool, or server\/\* for every tool of a server/u),
      'Line 3, /tools/2: graph/search is listed twice',
    ]);
  });
});

describe('a reasoning function that names tools', () => {
  it('runs with the tools it names, under their model-facing names, and lets their session go', async () => {
    const fake = await graphServer();
    const run = reasoningWithTools(
      accessTo(fake),
      callingTools([['mcp__graph__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.'))),
    );

    const ran = await run.executing(naming('graph/search'));

    expect(ran).toMatchObject({ _tag: 'Success', value: { output: 'Acme has 2 rows.' } });
    expect(run.requests()[0]?.tools).toMatchObject({
      offered: [{ name: 'mcp__graph__search' }],
      runBoundMs: 600_000,
    });
    expect(run.journal.recorded().map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
    expect(fake.received()).toEqual([
      { tool: 'search', arguments: { query: 'acme' }, meta: { 'com.beonauto/run_id': runContext.id } },
    ]);
    expect(fake.endedSessions()).toBe(1);
  });

  it('says it may change something outside when MCP servers are configured', async () => {
    const run = reasoningWithTools(accessTo(await graphServer()));

    expect(run.capability.mayChangeOutside).toBe(true);
    expect(reasoningWith().capability.mayChangeOutside).toBe(false);
  });
});

describe('a tool a reasoning function names that is not offered', () => {
  it('rejects the run as unavailable when no server of that name is configured for its brain', async () => {
    const run = reasoningWithTools(accessTo(await graphServer(), 'globex'));

    expect(await run.executing(naming('graph/search'))).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'unavailable',
          kind: 'tool_not_offered',
          because: 'mcp_server_not_configured',
        }),
      ),
    );
  });

  it('rejects the run as unavailable when no MCP server is configured at all', async () => {
    expect(await reasoningWith().executing(naming('graph/search', 'crm/find'))).toEqual(
      Exit.fail(
        expect.objectContaining({
          kind: 'tool_not_offered',
          because: 'mcp_server_not_configured',
          detail:
            'The reasoning function names graph/search and crm/find, but no MCP server is configured on this server',
        }),
      ),
    );
  });

  it('rejects the run as unavailable when its server cannot be used', async () => {
    const fake = await serveFakeMcp();
    await fake.close();
    const run = reasoningWithTools(accessTo(fake));

    expect(await run.executing(naming('graph/search'))).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'mcp_server_failed', because: 'unreachable' })),
    );
  });
});

describe('a reasoning function with tools whose model is not offered', () => {
  it('is rejected before its tools are opened, so it reaches no server and starts no process', async () => {
    const fake = await graphServer();
    const { languageModel } = await accessFor({ OPENAI_API_KEY: 'k' }, {});
    const capability = makeReasoningFunctionAdapter({
      languageModel,
      offered: { providers: ['openai'], aliases: [] },
      tools: accessTo(fake),
    });
    const prepared = Effect.runSync(capability.prepare(naming('graph/search')));

    expect(await Effect.runPromiseExit(prepared.run({}, runContext))).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'model_not_offered', because: 'provider_not_configured' })),
    );
    expect(fake.seen()).toEqual([]);
  });
});
