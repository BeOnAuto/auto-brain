import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { secretsOf } from '../bounds/secrets.ts';
import type { AuthSettings, HttpServerSettings } from '../settings/mcp-settings.ts';
import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from '../testing/index.ts';
import { ignored } from './ignored.ts';
import type { CallSettled, McpConnection } from './mcp-connection.ts';
import { failureOf } from './server-failures.ts';
import { serverLink } from './server-links.ts';

const timing = { callMs: 5000, openMs: 5000, longestRetryWaitMs: 1000 };

const clientSecret = 'graph-client-secret-81c2';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(options?: FakeMcpOptions): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp(options);
  closing.push(fake.close);
  return fake;
}

function httpSettings(url: string, changes: Partial<HttpServerSettings> = {}): HttpServerSettings {
  return {
    type: 'http',
    name: 'graph',
    url,
    headers: new Map(),
    auth: null,
    org: 'acme',
    brains: null,
    record_content: false,
    request_id: null,
    ...changes,
  };
}

function authOf(fake: FakeMcpServer): AuthSettings {
  return {
    issuer: fake.origin,
    client_id: 'brain',
    scope: null,
    credential: { kind: 'client_secret', client_secret: Redacted.make(clientSecret) },
  };
}

function linked(settings: HttpServerSettings) {
  const secrets = secretsOf([]);
  const link = serverLink(settings, {
    fetch: globalThis.fetch,
    secrets,
    now: Date.now,
    timing,
    reportOutput: ignored,
  });
  closing.push(link.stop);
  return { link, secrets };
}

const searched = (connection: McpConnection) =>
  connection.call({
    tool: 'search',
    input: { query: 'acme' },
    meta: {},
    signal: new AbortController().signal,
    timeoutMs: timing.callMs,
  });

function failureOfCall(settled: CallSettled) {
  return 'error' in settled ? failureOf(settled.error) : undefined;
}

async function failureOfTaking(link: ReturnType<typeof linked>['link']) {
  return failureOf(
    await link.take().then(
      () => null,
      (error: unknown) => error,
    ),
  );
}

describe('a link to an http server', () => {
  it('shares one session between its holders and ends it when the last lets go', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));

    const first = await link.take();
    const second = await link.take();
    await link.release();
    const openWhileHeld = fake.openSessions();
    await link.release();

    expect(second).toBe(first);
    expect(openWhileHeld).toBe(1);
    expect(fake.openSessions()).toBe(0);
    expect(fake.endedSessions()).toBe(1);
    expect(fake.seen().map(({ method }) => method)).toContain('DELETE');
  });

  it('opens a new session in place of a failed one, once for everyone who saw it fail', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));

    const failed = await link.take();
    const renewed = await link.renew(failed);
    const renewedAgain = await link.renew(failed);

    expect(renewedAgain).toBe(renewed);
    expect(renewed).not.toBe(failed);
    expect(fake.endedSessions()).toBe(1);
    expect(await searched(renewed)).toMatchObject({ result: { content: [{ text: 'Found 2 rows for acme.' }] } });
  });
});

describe('opening a session', () => {
  it('forgets a session it could not open, and opens one on the next take', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));
    fake.answerNextWith(503);

    expect(await failureOfTaking(link)).toEqual({ kind: 'failing', message: 'The MCP server answered HTTP 503' });
    expect(await link.take()).toBeDefined();
  });

  it('cannot reach a server that is not listening', async () => {
    const fake = await serveFakeMcp();
    await fake.close();
    const { link } = linked(httpSettings(fake.url));

    expect(await failureOfTaking(link)).toEqual({
      kind: 'unreachable',
      message: 'The MCP server could not be reached',
    });
  });

  it('waits out a 429 that asks for no longer than the longest wait, once', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));
    fake.answerNextWith(429, 1, { 'retry-after': '0' });

    expect(await searched(await link.take())).toMatchObject({
      result: { content: [{ text: 'Found 2 rows for acme.' }] },
    });
    expect(fake.seen().filter(({ rpc }) => rpc === 'initialize')).toHaveLength(2);
  });

  it('fails on a 429 that asks for a longer wait, for none, or comes again', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));
    const rateLimited = { kind: 'rate_limited', message: 'The MCP server answered HTTP 429' };

    fake.answerNextWith(429, 1, { 'retry-after': '5' });
    expect(await failureOfTaking(link)).toEqual(rateLimited);
    fake.answerNextWith(429);
    expect(await failureOfTaking(link)).toEqual(rateLimited);
    fake.answerNextWith(429, 2, { 'retry-after': '0' });
    expect(await failureOfTaking(link)).toEqual(rateLimited);
  });
});

describe('the headers and the end of a session', () => {
  it('sends the headers of its entry', async () => {
    const fake = await fakeServer({ bearer: 'graph-api-key-4f1d9a7c2b' });
    const { link } = linked(
      httpSettings(fake.url, {
        headers: new Map([['Authorization', Redacted.make('Bearer graph-api-key-4f1d9a7c2b')]]),
      }),
    );
    const { link: unauthorized } = linked(httpSettings(fake.url));

    expect(await searched(await link.take())).toMatchObject({ result: { content: [{ type: 'text' }] } });
    expect(await failureOfTaking(unauthorized)).toMatchObject({ kind: 'failing' });
  });

  it('stops the session it holds, and stops nothing when it holds none', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));

    await link.stop();
    await link.take();
    await link.stop();

    expect(fake.endedSessions()).toBe(1);
  });
});

describe('a link to an http server with an auth block', () => {
  it('sends a token minted from the client credentials, scrubbed from what the server says', async () => {
    const fake = await fakeServer({ client: { clientId: 'brain', clientSecret, expiresInSeconds: 3600 } });
    const { link, secrets } = linked(httpSettings(fake.url, { auth: authOf(fake) }));

    await link.take();
    const [, token] = String(fake.seen().at(-1)?.authorization).split(' ');

    expect(fake.tokenRequests()).toBe(1);
    expect(secrets.scrub(`Rejected ${String(token)}`)).toBe('Rejected [redacted]');
  });

  it('authenticates again once on a 401, and fails on a second', async () => {
    const fake = await fakeServer({ client: { clientId: 'brain', clientSecret, expiresInSeconds: 3600 } });
    const { link } = linked(httpSettings(fake.url, { auth: authOf(fake) }));
    const connection = await link.take();

    fake.revokeTokens();
    const reauthenticated = await searched(connection);
    fake.answerNextWith(401, 2);
    const refused = await searched(connection);

    expect(reauthenticated).toMatchObject({ result: { content: [{ text: 'Found 2 rows for acme.' }] } });
    expect(failureOfCall(refused)).toEqual({
      kind: 'failing',
      message: 'The MCP server answered HTTP 401',
    });
    expect(fake.tokenRequests()).toBe(3);
  });
});
