import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { calledOpeningLinks, type LinkOpening } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { linkedAnswers, toolCallbackOf, type AnsweringServing } from './linked-answers.ts';

const page = 'https://studio.example/open?page=1';

const opened = { times: 0 };

const openPage = defineCommand('org', {
  name: 'open_page',
  title: 'Open page',
  description: 'Makes a page for the person to open. Use it when the person must act on a page. It answers the page.',
  route: { method: 'POST', path: '/pages' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ page: Schema.String, made: Schema.Number }),
  reasons: [],
  handle: () =>
    Effect.sync(() => {
      opened.times += 1;
      return { page, made: opened.times };
    }),
  plainLanguage: { task: 'make a page', attempt: () => 'make a page', outcome: ({ page: made }) => `Made ${made}.` },
  linkToOpen: ({ page: made }) => ({ message: 'Open the page to approve it', url: made }),
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [openPage] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function opening(how: Partial<LinkOpening> = {}) {
  const connection = { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } };
  return calledOpeningLinks(connection, { name: 'open_page', arguments: {} }, how);
}

describe('a tool whose operation gives a link to open', () => {
  it('asks a client of 2026-07-28 that opens links to open it, with its message, and answers once it was asked', async () => {
    const before = opened.times;

    const { answer, elicited } = await opening();

    expect(elicited).toEqual([{ mode: 'url', message: 'Open the page to approve it', url: page }]);
    expect(answer.structuredContent).toEqual({ page, made: before + 1 });
    expect(opened.times).toBe(before + 1);
  });

  it('answers the same when the person declines to open it', async () => {
    const before = opened.times;

    const { answer, elicited } = await opening({ action: 'decline' });

    expect(answer.structuredContent).toEqual({ page, made: before + 1 });
    expect(elicited).toHaveLength(1);
  });

  it('answers at once, with the link in the answer, a client that does not open links or speaks 2025-11-25', async () => {
    const formsAlone = await opening({ opens: 'forms alone' });
    const legacy = await opening({ revision: 'previous revision' });

    expect([formsAlone.elicited, legacy.elicited]).toEqual([[], []]);
    expect([formsAlone.answer.structuredContent, legacy.answer.structuredContent]).toMatchObject([{ page }, { page }]);
  });
});

const words = {
  kind: 'command',
  plainLanguage: { attempt: () => 'make a page', outcome: () => 'Made it.', remedies: {} },
  dispatch: () => Effect.die('never dispatched'),
  operationInputOf: () => ({}),
  linkToOpen: () => ({ message: 'Open', url: page }),
} as const;

const serving: AnsweringServing = {
  runCall: () => Promise.reject(new Error('The call was run')),
  reportThrown: () => ({ status: 'failed', incident: 'kept-answers' }),
  linkedAnswers: linkedAnswers(),
};

const answer = { content: [{ type: 'text', text: 'Made it.' }], structuredContent: { page } } as const;

function replaying(keptFor: Readonly<Record<string, string>>) {
  const caller = { id: 'acme-admin', org: 'acme', permissions: [], playbooks: '*' } as const;
  const kept = { tool: 'open_page', caller: 'acme-admin', org: 'acme', ...keptFor, answer };
  return toolCallbackOf(
    serving,
    { caller, org: 'acme', requestId: 'request', dropped: [] },
    { ...words, name: 'open_page' },
  )({}, { mcpReq: { id: 1, signal: new AbortController().signal, requestState: () => kept } });
}

describe('an answer kept for a retry', () => {
  it('is given back only to the tool, the caller and the org it was kept for, and otherwise the call runs', async () => {
    expect(await replaying({})).toEqual(answer);
    expect(await replaying({ tool: 'other_page' })).toMatchObject({ isError: true });
    expect(await replaying({ caller: 'acme-reader' })).toMatchObject({ isError: true });
    expect(await replaying({ org: 'globex' })).toMatchObject({ isError: true });
  });
});
