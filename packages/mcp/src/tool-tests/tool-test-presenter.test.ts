import { Buffer } from 'node:buffer';

import type { RecordedEvent } from '@beonauto/operations';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fakeApiKey,
  fakeRequestIdKey,
  inTurn,
  patientTiming,
  reportingAccess,
  serveFakeMcp,
  toolTests,
} from '../testing/index.ts';
import { toolTestPresenter } from './tool-test-presenter.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const givenUpAfterMs = 300;

async function recordedTests(entry: Readonly<Record<string, unknown>>, callMs: number, ...tested: readonly unknown[]) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = {
    url: fake.url,
    headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
    org: 'acme',
    testable: ['echo'],
    ...entry,
  };
  const { access } = reportingAccess(
    { graph },
    { timing: { ...patientTiming, callMs }, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const { test, recorded } = toolTests(access);
  await inTurn(tested, (input) => test(input));
  return recorded();
}

const answering = [
  { server: 'graph', tool: 'search', arguments: { query: 'acme' } },
  { server: 'graph', tool: 'denied' },
  { server: 'graph', tool: 'broken' },
];

const sleeping = { server: 'graph', tool: 'sleep', arguments: { ms: 5000 } };

function shown(records: readonly RecordedEvent[]) {
  return records.flatMap((record) => toolTestPresenter.present(record));
}

const fitsTheBound: unknown = expect.toSatisfy((data: unknown) => Buffer.byteLength(JSON.stringify(data)) <= 4096);

describe('the events of a test, as the brain shows them', () => {
  it('say who tested which tool of which server and how it answered, in the words of a run’s calls', async () => {
    const answered = await recordedTests({}, patientTiming.callMs, ...answering);
    const givenUp = await recordedTests({}, givenUpAfterMs, sleeping);
    const records = [...answered, ...givenUp];

    expect(shown(records).map(({ type, summary }) => `${type}: ${summary}`)).toEqual([
      'tool_test_started: Someone allowed to change the brain tested the search tool of graph.',
      'tool_test_answered: The tested tool answered.',
      'tool_test_started: Someone allowed to change the brain tested the denied tool of graph.',
      'tool_test_answered: The tested tool answered with an error.',
      'tool_test_started: Someone allowed to change the brain tested the broken tool of graph.',
      'tool_test_answered: The tested tool failed at its server.',
      'tool_test_started: Someone allowed to change the brain tested the sleep tool of graph.',
      'tool_test_answered: The tested tool took too long, so it was given up.',
    ]);
    expect(shown(records).map(({ causation_id: cause }) => cause)).toEqual(
      records.map(({ causationId }) => causationId),
    );
  });

  it('show their facts within 4 KiB, recorded content at 2 KiB and the server’s own id of the request', async () => {
    const records = await recordedTests({ record_content: true, request_id: fakeRequestIdKey }, patientTiming.callMs, {
      server: 'graph',
      tool: 'echo',
      arguments: { said: 'x'.repeat(6000) },
    });
    const [started, answered] = shown(records);

    expect(started?.data).toMatchObject({
      server: 'graph',
      tool: 'echo',
      by: 'acme-builder',
      arguments_bytes: Buffer.byteLength(JSON.stringify({ said: 'x'.repeat(6000) })),
    });
    expect(answered?.data).toMatchObject({ outcome: 'result', server_request_id: 'call-1' });
    expect([started?.data, answered?.data]).toEqual([fitsTheBound, fitsTheBound]);
    expect(Buffer.byteLength(JSON.stringify(started?.data['arguments_json'])) - 2).toBeLessThanOrEqual(2048);
    expect(Buffer.byteLength(JSON.stringify(answered?.data['result_json'])) - 2).toBeLessThanOrEqual(2048);
  });
});

const answeredWithoutARequestId = {
  type: 'tool_test_answered',
  test_id: '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
  outcome: 'server_failure',
  result_bytes: null,
  result_sha256: null,
  duration_ms: 12,
  jsonrpc_id: 'request-7',
  server_request_id: null,
  by: 'acme-builder',
  at: '2026-10-08T09:00:00.000Z',
};

describe('an answer that carries no result and no id of the server', () => {
  it('shows nulls where nothing was recorded, and an id the brain gave as text', () => {
    const [answered] = toolTestPresenter.present({
      id: '1f0e8d7c-6b5a-5d4c-8b3a-291817161514',
      cursor: 'c',
      causationId: null,
      correlationId: null,
      stream: 'brain/acme/alpha/tool-tests/0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
      version: 2,
      type: 'tool_test_answered',
      data: answeredWithoutARequestId,
      recordedAt: '2026-10-08T09:00:00.000Z',
    });

    expect(answered?.data).toMatchObject({ result_sha256: null, jsonrpc_id: 'request-7', server_request_id: null });
  });
});
