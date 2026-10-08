import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fakeApiKey,
  fakeStdioServerPath,
  patientTiming,
  reportingAccess,
  serveFakeMcp,
  stdioTestTimeoutMs,
  toolTests,
  type FakeMcpOptions,
  type FakeMcpServer,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
}, stdioTestTimeoutMs);

async function fakeServer(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, ...options });
  closing.push(fake.close);
  return fake;
}

function accessTo(servers: Readonly<Record<string, unknown>>) {
  const { access } = reportingAccess(servers, {
    timing: patientTiming,
    environment: { GRAPH_API_KEY: fakeApiKey, NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
  });
  closing.push(access.close);
  return access;
}

function graphOn(fake: FakeMcpServer) {
  return { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } };
}

function requestsOf(fake: FakeMcpServer): readonly string[] {
  return fake.seen().map(({ method, rpc = '' }) => `${method} ${rpc}`.trim());
}

async function until(holds: () => boolean, waited = 0): Promise<boolean> {
  if (holds() || waited >= 5000) {
    return holds();
  }
  await setTimeout(10);
  return until(holds, waited + 10);
}

const callAndEnd: ReadonlySet<string> = new Set(['POST tools/call', 'DELETE']);

const searching = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

describe('the session a test opens', () => {
  it('is ended once the test has answered, six requests in all, and five where the server issues no session id', async () => {
    const fake = await fakeServer();
    const sessionless = await fakeServer({ issuesSessionIds: false });

    await toolTests(accessTo(graphOn(fake))).test(searching);
    await toolTests(accessTo(graphOn(sessionless))).test(searching);

    expect(requestsOf(fake)).toEqual(
      expect.arrayContaining(['POST initialize', 'POST notifications/initialized', 'GET', 'POST tools/list']),
    );
    expect(requestsOf(fake).filter((request) => callAndEnd.has(request))).toEqual(['POST tools/call', 'DELETE']);
    expect(requestsOf(fake)).toHaveLength(6);
    expect(requestsOf(sessionless)).toHaveLength(5);
    expect(requestsOf(sessionless)).not.toContain('DELETE');
    expect([fake.openSessions(), fake.endedSessions()]).toEqual([0, 1]);
  });

  it('is one for a test and a listing made at once', async () => {
    const fake = await fakeServer();
    const access = accessTo(graphOn(fake));

    await Promise.all([
      toolTests(access).test(searching),
      Effect.runPromise(access.listServers({ org: 'acme', brain: 'alpha' })),
    ]);

    expect(requestsOf(fake).filter((request) => request === 'POST initialize')).toHaveLength(1);
    expect(fake.endedSessions()).toBe(1);
  });
});

describe('a test whose caller goes away while the tool is called', () => {
  it('records a start and no answer, answers nothing, sends no second call and still lets the session go', async () => {
    const fake = await fakeServer();
    const access = accessTo(graphOn(fake));
    const { test, recorded } = toolTests(access);
    const leaving = new AbortController();

    const settling = test({ server: 'graph', tool: 'sleep', arguments: { ms: 5000 } }, { signal: leaving.signal });
    await until(() => fake.received().length === 1);
    leaving.abort();
    const settled = await settling;

    expect(settled).toEqual({ status: 'cancelled' });
    expect(await until(() => fake.endedSessions() === 1)).toBe(true);
    expect((await recorded()).map(({ type }) => type)).toEqual(['tool_test_started']);
    expect(fake.received()).toHaveLength(1);
    await toolTests(access).test(searching);
    expect([fake.endedSessions(), fake.openSessions()]).toEqual([2, 0]);
  });
});

describe('a test the ledger cannot record', () => {
  it('fails with an incident and sends no call, since the start is recorded first', async () => {
    const fake = await fakeServer();
    const { test, incidents } = toolTests(accessTo(graphOn(fake)), { writesRefused: true });

    expect(await test(searching)).toEqual({ status: 'failed', incident: incidents()[0]?.id });
    expect(incidents()).toHaveLength(1);
    expect(fake.received()).toEqual([]);
    expect(await until(() => fake.endedSessions() === 1)).toBe(true);
  });
});

describe('a test the ledger cannot record once its caller has gone', () => {
  it('is reported as an incident naming the test, as a failure the caller saw would be, and sends no call', async () => {
    const fake = await fakeServer();
    const leaving = new AbortController();
    const recording = Promise.withResolvers<void>();
    const { test, incidents, writesAttempted } = toolTests(accessTo(graphOn(fake)), {
      writesRefused: true,
      writesHeldUntil: recording.promise,
    });

    const settling = test(searching, { signal: leaving.signal });
    await until(() => writesAttempted() === 1);
    leaving.abort();
    recording.resolve();
    const settled = await settling;

    expect(settled).toEqual({ status: 'cancelled' });
    expect(incidents()).toHaveLength(1);
    expect(incidents()[0]).toMatchObject({
      original: { message: 'The ledger refused the write' },
      call: { operation: 'test_tool_call', org: 'acme', brain: 'alpha', caller: 'acme-builder' },
    });
    expect(fake.received()).toEqual([]);
    expect(await until(() => fake.endedSessions() === 1)).toBe(true);
  });
});

describe('a test of a stdio server', { timeout: stdioTestTimeoutMs }, () => {
  it('starts its process once, and keeps it for the next test', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tool-tests-'));
    closing.push(() => {
      rmSync(folder, { recursive: true });
      return Promise.resolve();
    });
    const limitless = {
      command: process.execPath,
      args: [fakeStdioServerPath, '--start-once', join(folder, 'started')],
      env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
      org: 'acme',
    };
    const { test } = toolTests(accessTo({ limitless }));

    const first = await test({ server: 'limitless', tool: 'search', arguments: { query: 'acme' } });
    const second = await test({ server: 'limitless', tool: 'search', arguments: { query: 'again' } });

    expect([first, second]).toMatchObject([
      { status: 'succeeded', output: { outcome: 'result', text: 'Found 2 rows for acme.' } },
      { status: 'succeeded', output: { outcome: 'result', text: 'Found 2 rows for again.' } },
    ]);
  });
});
