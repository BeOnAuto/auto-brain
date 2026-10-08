import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  controlledSignals,
  fakeApiKey,
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  serveFakeMcp,
  toolRun,
  toolTests,
  type AccessOptions,
  type FakeMcpServer,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const aTestId: unknown = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

const aDuration: unknown = expect.any(Number);

const aTime: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

const decodeTested = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ test_id: Schema.String }) }));

function testIdOf(settled: unknown): string {
  return decodeTested(settled).output.test_id;
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(fake: FakeMcpServer, options: AccessOptions = {}) {
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const reporting = reportingAccess(
    { graph },
    { timing: patientTiming, ...options, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(reporting.access.close);
  return reporting.access;
}

async function testerOf(options: AccessOptions = {}) {
  const fake = await fakeServer();
  const access = accessTo(fake, options);
  return { fake, access, ...toolTests(access) };
}

describe('test_tool_call', () => {
  it('is a command of the brain at POST /tool-servers/{server}/tools/{tool}/test that reaches outside', async () => {
    const { registration } = await testerOf();
    const listing = await testerOf({ testable: ['graph/echo'] });

    expect(registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      name: 'test_tool_call',
      title: 'Test a tool call',
      route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/test' },
      pathParameters: ['server', 'tool'],
      reachesOutside: true,
      mayChangeOutside: false,
      irreversible: false,
      repeatable: false,
      permissions: ['brain:write'],
      reasons: ['invalid_input', 'unavailable'],
    });
    expect(listing.registration.mayChangeOutside).toBe(true);
  });
});

describe('a test of a tool its server marks read-only', () => {
  it('calls the tool once and answers what a run of a reasoning function would, with the size, the time and its id', async () => {
    const { fake, test } = await testerOf();

    expect(await test({ server: 'graph', tool: 'search', arguments: { query: 'acme' } })).toEqual({
      status: 'succeeded',
      output: {
        test_id: aTestId,
        server: 'graph',
        tool: 'search',
        outcome: 'result',
        text: 'Found 2 rows for acme.',
        result_bytes: Buffer.byteLength(
          JSON.stringify({ content: [{ type: 'text', text: 'Found 2 rows for acme.' }] }),
        ),
        duration_ms: aDuration,
        tested_at: aTime,
      },
    });
    expect(fake.received()).toMatchObject([{ tool: 'search', arguments: { query: 'acme' } }]);
  });

  it('answers in text exactly what the model of a run that calls the same tool sees', async () => {
    const { access, test } = await testerOf();
    const run = await Effect.runPromise(
      access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'profile' }]),
    );
    closing.push(run.close);

    const seenInARun = await run.offered[0]?.call({ callId: 'call-1', input: {} }, controlledSignals());
    const tested = await test({ server: 'graph', tool: 'profile' });

    expect(tested).toMatchObject({ status: 'succeeded', output: { outcome: 'result', text: seenInARun?.text } });
    expect(seenInARun?.text).toBe('{"name":"Ada","rows":2}');
  });

  it('carries the id of the test in the metadata of the call, and no id of a run', async () => {
    const { fake, test } = await testerOf();

    const tested = await test({ server: 'graph', tool: 'search', arguments: { query: 'acme' } });

    expect(fake.received()).toEqual([
      { tool: 'search', arguments: { query: 'acme' }, meta: { 'com.beonauto/tool_test_id': testIdOf(tested) } },
    ]);
  });
});
