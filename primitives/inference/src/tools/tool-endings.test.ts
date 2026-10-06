import { reportingAccess, serveFakeMcp, type FakeMcpServer } from '@beonauto/mcp/testing';
import { Unavailable } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { ContentRefused, TimedOut, ToolsStopped, type ToolsStoppedBecause } from '../index.ts';
import { callingTools, type ScriptedCall } from '../testing/calling-tools.ts';
import { reasoningWithTools } from '../testing/reasoning-runs.ts';
import type { ScriptedReply } from '../testing/scripted-language-model.ts';
import { documentOf } from '../testing/spec-documents.ts';

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

function ending(fake: FakeMcpServer, reply: ScriptedReply) {
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  const source = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/*]', 'Summarize acme.');
  return reasoningWithTools(access, reply).executing(source);
}

const stoppedBy =
  (because: ToolsStoppedBecause, detail: string): ScriptedReply =>
  () =>
    Effect.fail(new ToolsStopped({ detail, provider: 'anthropic', because }));

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const refused: ScriptedReply = () =>
  Effect.fail(
    new ContentRefused({
      detail: 'anthropic refused',
      provider: 'anthropic',
      status: 400,
      raw_finish_reason: null,
      usage: null,
    }),
  );

const searched: readonly ScriptedCall[] = [['mcp__graph__search', { query: 'acme' }]];

const used = 'after the run called the search tool of graph';

function unfinished(because: string, detail: string) {
  return Exit.fail(expect.objectContaining({ kind: 'tools_unfinished', because, detail }));
}

describe('a run that called tools and could not answer', () => {
  it('is unavailable as unfinished because the model kept calling tools, and lets its session go', async () => {
    const fake = await graphServer();

    expect(await ending(fake, callingTools(searched, stoppedBy('no_answer', 'anthropic kept calling tools')))).toEqual(
      unfinished('no_answer', `anthropic kept calling tools, ${used}`),
    );
    expect(fake.endedSessions()).toBe(1);
  });

  it('is unavailable as unfinished because it reached its bound', async () => {
    const reply = callingTools(searched, stoppedBy('run_bound', 'The run went on for 600000 ms'));

    expect(await ending(await graphServer(), reply)).toEqual(
      unfinished('run_bound', `The run went on for 600000 ms, ${used}`),
    );
  });
});

describe('a run that called tools and lost its model', () => {
  it('is unavailable as unfinished because the model stopped answering, never asking to try again', async () => {
    expect(await ending(await graphServer(), callingTools(searched, timedOut))).toEqual(
      unfinished('model_unavailable', `anthropic did not answer within 60000 ms, ${used}`),
    );
  });

  it('keeps a rejection that is not unavailable', async () => {
    expect(await ending(await graphServer(), callingTools(searched, refused))).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'invalid_input' })),
    );
  });
});

describe('a run whose tool servers kept failing', () => {
  it('is unavailable as unfinished because a tool server kept failing', async () => {
    const broken = [1, 2, 3, 4, 5].map((attempt): ScriptedCall => ['mcp__graph__broken', { attempt }]);
    const reply = callingTools(broken, stoppedBy('server_failed', 'Its tool servers failed'));

    expect(await ending(await graphServer(), reply)).toEqual(
      unfinished('server_failed', 'A tool server kept failing, after the run called the broken tool of graph'),
    );
  });

  it('is unavailable as unfinished because a tool server kept asking it to slow down', async () => {
    const fake = await graphServer();
    const limited = ['a', 'b', 'c', 'd', 'e'].map((query): ScriptedCall => ['mcp__graph__search', { query }]);
    const reply = callingTools(limited, stoppedBy('server_failed', 'Its tool servers failed'));
    const limiting: ScriptedReply = (request) =>
      Effect.sync(() => {
        fake.answerNextWith(429, 5);
      }).pipe(Effect.andThen(reply(request)));

    expect(await ending(fake, limiting)).toEqual(
      unfinished('server_failed', `A tool server kept asking the run to slow down for longer than it waits, ${used}`),
    );
  });
});

describe('a run that could not finish before it called a tool', () => {
  it('is unavailable as before, without saying that tools were called', async () => {
    const fake = await graphServer();

    expect(await ending(fake, stoppedBy('no_answer', 'anthropic kept calling tools'))).toEqual(
      Exit.fail(new Unavailable({ detail: 'anthropic kept calling tools' })),
    );
    expect(await ending(fake, timedOut)).toEqual(
      Exit.fail(new Unavailable({ detail: 'anthropic did not answer within 60000 ms; try again later' })),
    );
  });
});
